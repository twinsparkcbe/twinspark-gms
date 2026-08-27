-- Editable line price on a Sale — the counter can negotiate a price at the
-- moment of sale instead of being locked to the catalogue.
--
-- Confirmed with the developer 2026-08-27:
--   * Admin AND Sales Person may change a line price (haggling is normal at
--     the counter; forcing a call to the owner for every Rs 50 would just
--     push staff off the system).
--   * Below the item's cost price is Admin-only — see the guard in the
--     PRODUCT branch below.
--   * The change applies to THIS SALE ONLY. The catalogue price still comes
--     from the newest purchase batch (0011/0012) and is untouched here.
--   * The printed invoice shows only what was charged; the original list
--     price stays visible inside the app.
--
-- WHY list_price IS STORED RATHER THAN INFERRED: without it, a line sold at
-- Rs 5,000 is indistinguishable from an item whose catalogue price was always
-- Rs 5,000. "Why is our margin down this month, and who gave it away?" then
-- has no answer, because the catalogue price moves on its own every time a
-- new purchase batch lands. Recording both halves at the moment of sale is
-- the only way the question stays answerable later.
--
-- NOTHING CHANGES IN THE PROFIT REPORT, deliberately. Revenue there comes
-- from sales.grand_total (built from these lines) and COGS from the actual
-- FIFO batch cost in stock_movements x purchase_entries.unit_price — so an
-- overridden price already flows through correctly. Same for Revenue, GST,
-- Collections and the Sales report.

-- ---------------------------------------------------------------------------
-- 1. What the catalogue said, alongside what was charged
-- ---------------------------------------------------------------------------

alter table public.sale_items
  add column if not exists list_price numeric(12, 2);

alter table public.sale_items
  drop constraint if exists sale_items_list_price_positive;

alter table public.sale_items
  add constraint sale_items_list_price_positive
    check (list_price is null or list_price > 0);

-- Generated, so a discount can never be recorded as anything other than the
-- arithmetic of the two prices actually stored on the row.
--
-- Combo lines are excluded on purpose: an INCLUDED component carries
-- unit_selling_price = 0 because the combo price already covers it, and
-- counting that as a discount would report a spectacular fictional giveaway
-- on every combo sold. A price ABOVE list yields 0 rather than a negative —
-- this column answers "how much did we give away", and an upcharge is still
-- visible by comparing the two price columns directly.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'sale_items'
       and column_name  = 'discount_given'
  ) then
    alter table public.sale_items
      add column discount_given numeric(14, 2) generated always as (
        case
          when line_type = 'PRODUCT'
           and combo_id is null
           and list_price is not null
          then greatest(0, list_price - coalesce(unit_selling_price, 0)) * coalesce(quantity, 0)
          else 0
        end
      ) stored;
  end if;
end $$;

-- Existing lines predate the column and stay null: nobody knows what the
-- catalogue said on the day they were sold, and back-filling today's price
-- would invent discounts that never happened.

create index if not exists sale_items_discount_idx
  on public.sale_items (sale_id)
  where discount_given > 0;

-- ---------------------------------------------------------------------------
-- 2. replace_sale_lines() — the single place every sale line is written.
--
--    record_sale() and record_sale_with_payment() both delegate here, and
--    edit_sale() calls it with p_keep_existing_prices, so teaching this one
--    function about an override covers creating, editing and re-pricing.
-- ---------------------------------------------------------------------------

create or replace function public.replace_sale_lines(
  p_sale_id uuid,
  p_lines jsonb,
  p_keep_existing_prices boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line jsonb;
  v_position integer := 0;
  v_product_count integer := 0;
  v_subtotal numeric := 0;
  v_installation_total numeric := 0;
  v_unit_price numeric;
  v_quantity integer;
  v_subtype text;
  v_wheel_count integer;
  v_amount numeric;
  v_description text;
  v_installed_by text;
  v_combo_id uuid;
  v_combo record;
  v_component record;
  v_component_qty integer;
  v_component_price numeric;
  v_combo_contents text[];
  v_combo_list_value numeric;
  v_item_id uuid;
  v_price_snapshot jsonb := '{}'::jsonb;
  v_list_price numeric;
  v_cost_price numeric;
  v_item_active boolean;
  v_snapshot_price numeric;
  v_snapshot_list numeric;
  v_override_price numeric;
  v_gst_amount numeric;
  v_discount_amount numeric;
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'A sale requires at least one line item' using errcode = '22023';
  end if;

  if coalesce(p_keep_existing_prices, false) then
    -- Both halves are snapshotted now: what the customer was charged AND what
    -- the catalogue said at the time. Carrying list_price across an edit is
    -- what keeps "discount given" stable — re-reading today's catalogue would
    -- silently restate a past discount every time the bill was corrected.
    select coalesce(
             jsonb_object_agg(
               s.inventory_item_id::text,
               jsonb_build_object('charged', s.unit_selling_price, 'list', s.list_price)
             ), '{}'::jsonb)
      into v_price_snapshot
      from (
        select distinct on (inventory_item_id) inventory_item_id, unit_selling_price, list_price
          from public.sale_items
         where sale_id = p_sale_id
           and line_type = 'PRODUCT'
           and inventory_item_id is not null
           and coalesce(included_in_combo, false) = false
           and combo_id is null
         order by inventory_item_id, position
      ) s;
  end if;

  delete from public.sale_items where sale_id = p_sale_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_position := v_position + 1;

    if (v_line ->> 'line_type') = 'PRODUCT' then
      v_product_count := v_product_count + 1;
      v_quantity := (v_line ->> 'quantity')::integer;
      v_item_id := (v_line ->> 'inventory_item_id')::uuid;

      if v_quantity is null or v_quantity <= 0 then
        raise exception 'Quantity must be greater than zero' using errcode = '22023';
      end if;

      -- Read the catalogue price, the cost, and whether the item is sellable
      -- in one go: list_price is recorded on every line so a negotiated
      -- discount stays distinguishable from an item that was simply cheap,
      -- and cost is what the below-cost guard tests against.
      select selling_price, purchase_price, is_active
        into v_list_price, v_cost_price, v_item_active
        from public.inventory_items
       where id = v_item_id;

      if not found then
        raise exception 'Inventory item % not found', v_item_id using errcode = 'P0002';
      end if;

      v_snapshot_price := (v_price_snapshot -> v_item_id::text ->> 'charged')::numeric;
      v_snapshot_list  := (v_price_snapshot -> v_item_id::text ->> 'list')::numeric;

      -- A new or swapped item has to be sellable today. One already on this
      -- invoice is exempt: it was legitimately sold at the time, and refusing
      -- would make the bill uncorrectable.
      if v_snapshot_price is null and not v_item_active then
        raise exception 'Inventory item % not found or inactive', v_item_id using errcode = 'P0002';
      end if;

      -- Price precedence: what the counter negotiated for THIS sale, else what
      -- the customer was already charged on this invoice, else the catalogue.
      v_override_price := (v_line ->> 'unit_selling_price')::numeric;

      if v_override_price is not null then
        if v_override_price <= 0 then
          raise exception 'A line price must be greater than zero' using errcode = '22023';
        end if;

        -- Haggling at the counter is normal and both roles may do it. Selling
        -- BELOW cost is the one move a Sales Person cannot make unaided — it
        -- is either a mis-key or something the owner has to have agreed to.
        if v_cost_price is not null and v_override_price < v_cost_price and not public.is_admin() then
          raise exception 'Only an Administrator can sell below the cost price (cost %)', v_cost_price
            using errcode = '42501';
        end if;

        v_unit_price := v_override_price;
      elsif v_snapshot_price is not null then
        v_unit_price := v_snapshot_price;
      else
        v_unit_price := v_list_price;
      end if;

      insert into public.sale_items
        (sale_id, position, line_type, inventory_item_id, quantity, unit_selling_price, list_price)
      values
        (p_sale_id, v_position, 'PRODUCT', v_item_id, v_quantity, v_unit_price,
         -- Whatever the catalogue said when this line was FIRST written.
         coalesce(v_snapshot_list, v_list_price));

      v_subtotal := v_subtotal + (v_unit_price * v_quantity);

      perform public.adjust_stock(v_item_id, -v_quantity, 'SALE', 'sales', null);

    elsif (v_line ->> 'line_type') = 'COMBO' then
      v_combo_id := (v_line ->> 'combo_id')::uuid;
      v_quantity := coalesce((v_line ->> 'quantity')::integer, 1);

      if v_quantity <= 0 then
        raise exception 'Combo quantity must be greater than zero' using errcode = '22023';
      end if;

      select * into v_combo from public.combos where id = v_combo_id;
      if not found then
        raise exception 'Combo % not found', v_combo_id using errcode = 'P0002';
      end if;
      if not v_combo.is_active then
        raise exception 'Combo "%" is switched off and cannot be sold', v_combo.name using errcode = '22023';
      end if;
      if v_combo.valid_from is not null and (now() at time zone 'Asia/Kolkata')::date < v_combo.valid_from then
        raise exception 'Combo "%" has not started yet', v_combo.name using errcode = '22023';
      end if;
      if v_combo.valid_to is not null and (now() at time zone 'Asia/Kolkata')::date > v_combo.valid_to then
        raise exception 'Combo "%" has ended', v_combo.name using errcode = '22023';
      end if;

      select coalesce(array_agg(
               case when c.quantity * v_quantity > 1
                    then coalesce(p.name, s.name, i.product_name, 'Item') || ' x' || (c.quantity * v_quantity)
                    else coalesce(p.name, s.name, i.product_name, 'Item')
               end
               order by c.position
             ), '{}')
        into v_combo_contents
        from public.combo_components c
        left join public.general_service_packages p on p.id = c.general_service_package_id
        left join public.specific_services s on s.id = c.specific_service_id
        left join public.inventory_items i on i.id = c.inventory_item_id
       where c.combo_id = v_combo_id and c.pricing = 'INCLUDED';

      select coalesce(sum(
               case
                 when c.component_type = 'PACKAGE' then coalesce(p.service_charge, 0)
                 when c.component_type = 'SPECIFIC' then coalesce(s.default_charge, 0)
                 else coalesce(i.selling_price, 0)
               end * c.quantity
             ), 0) * v_quantity
        into v_combo_list_value
        from public.combo_components c
        left join public.general_service_packages p on p.id = c.general_service_package_id
        left join public.specific_services s on s.id = c.specific_service_id
        left join public.inventory_items i on i.id = c.inventory_item_id
       where c.combo_id = v_combo_id and c.pricing = 'INCLUDED';

      v_amount := coalesce((v_line ->> 'amount')::numeric, v_combo.combo_price * v_quantity);
      if v_amount < 0 then
        raise exception 'Combo amount cannot be negative' using errcode = '22023';
      end if;

      insert into public.sale_items
        (sale_id, position, line_type, combo_id, combo_contents, combo_list_value, description, amount, quantity)
      values
        (p_sale_id, v_position, 'COMBO', v_combo_id, v_combo_contents, v_combo_list_value, v_combo.name, v_amount, v_quantity);

      v_subtotal := v_subtotal + v_amount;

      for v_component in
        select c.inventory_item_id, c.quantity, c.pricing, i.selling_price, i.is_active, i.product_name
          from public.combo_components c
          join public.inventory_items i on i.id = c.inventory_item_id
         where c.combo_id = v_combo_id and c.component_type = 'ITEM'
         order by c.position
      loop
        if not v_component.is_active then
          raise exception 'Inventory item "%" in this combo is inactive', v_component.product_name using errcode = 'P0002';
        end if;

        v_position := v_position + 1;
        v_component_qty := v_component.quantity * v_quantity;
        v_component_price := case when v_component.pricing = 'INCLUDED' then 0 else v_component.selling_price end;

        insert into public.sale_items
          (sale_id, position, line_type, inventory_item_id, quantity, unit_selling_price, combo_id, included_in_combo)
        values
          (p_sale_id, v_position, 'PRODUCT', v_component.inventory_item_id, v_component_qty, v_component_price,
           v_combo_id, v_component.pricing = 'INCLUDED');

        v_subtotal := v_subtotal + (v_component_price * v_component_qty);
        v_product_count := v_product_count + 1;

        perform public.adjust_stock(v_component.inventory_item_id, -v_component_qty, 'SALE', 'sales', null);
      end loop;

    elsif (v_line ->> 'line_type') = 'INSTALLATION' then
      v_subtype := v_line ->> 'installation_subtype';
      v_wheel_count := (v_line ->> 'wheel_count')::integer;
      v_description := nullif(btrim(coalesce(v_line ->> 'description', '')), '');
      v_installed_by := nullif(btrim(coalesce(v_line ->> 'installed_by', '')), '');

      if v_subtype = 'TYRE_FITTING' then
        if v_wheel_count is null or v_wheel_count <= 0 then
          raise exception 'Wheel count is required for Tyre Fitting' using errcode = '22023';
        end if;
        v_amount := coalesce((v_line ->> 'amount')::numeric, v_wheel_count * 300);
      elsif v_subtype = 'CUSTOM' then
        if v_description is null then
          raise exception 'A description is required for a custom installation charge' using errcode = '22023';
        end if;
        v_amount := (v_line ->> 'amount')::numeric;
        if v_amount is null then
          raise exception 'An amount is required for a custom installation charge' using errcode = '22023';
        end if;
      else
        raise exception 'Unknown installation subtype %', v_subtype using errcode = '22023';
      end if;

      if v_amount < 0 then
        raise exception 'Installation amount cannot be negative' using errcode = '22023';
      end if;

      insert into public.sale_items
        (sale_id, position, line_type, installation_subtype, wheel_count, description, amount, installed_by)
      values
        (p_sale_id, v_position, 'INSTALLATION', v_subtype, v_wheel_count, v_description, v_amount, v_installed_by);

      v_installation_total := v_installation_total + v_amount;
    else
      raise exception 'Unknown line type %', v_line ->> 'line_type' using errcode = '22023';
    end if;
  end loop;

  if v_product_count = 0 then
    raise exception 'A sale requires at least one product line' using errcode = '22023';
  end if;

  select gst_amount, discount_amount into v_gst_amount, v_discount_amount
    from public.sales where id = p_sale_id;

  update public.sales
    set subtotal = v_subtotal,
        installation_total = v_installation_total,
        grand_total = v_subtotal + v_installation_total + coalesce(v_gst_amount, 0) - coalesce(v_discount_amount, 0)
    where id = p_sale_id;
end;
$$;
