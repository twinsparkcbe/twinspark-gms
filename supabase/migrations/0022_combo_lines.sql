-- Combo Offers, part 2 — selling one (doc/service-combo-offers-plan.md §3.C/§3.D).
--
-- 0021 defined what a combo *is*. This lets a Service Job or a Sale actually
-- carry one, which needs three things on the line tables:
--
--   combo_id            which offer this line came from, so reports can group
--                       by combo and the UI can tag the row
--   combo_contents      the breakdown printed under the combo line, snapshotted
--                       as text at insert time — never re-read from the combo
--                       definition, which is free to change tomorrow (§16)
--   included_in_combo   on the stock rows: billed at ₹0, but still deducted
--
-- Cost of goods needs no new column. getCostOfGoodsSold() derives cost from
-- stock_movements joined to the FIFO purchase batch, so an item billed at ₹0
-- still carries its real purchase cost — the combo can't read as pure margin.
--
-- Idempotency note (see prior migration headers): every statement here is
-- guarded to be safely re-runnable.

-- ---------------------------------------------------------------------------
-- 1. Service Job lines — a new COMBO line type.
-- ---------------------------------------------------------------------------

alter table public.service_job_lines
  add column if not exists combo_id uuid references public.combos (id) on delete restrict;

alter table public.service_job_lines
  add column if not exists combo_contents text[];

-- What the bundle's contents were worth separately, at the moment it was
-- sold. Snapshotted rather than derived, for the same reason as every other
-- price here: the catalog moves, and last month's "You saved ₹1,741" must
-- keep saying ₹1,741.
alter table public.service_job_lines
  add column if not exists combo_list_value numeric(12, 2) check (combo_list_value is null or combo_list_value >= 0);

-- line_type gains 'COMBO'. Text + check (not a Postgres enum) precisely so
-- this is a constraint swap rather than an ALTER TYPE — the reasoning
-- recorded in 0016 §4, now being cashed in.
alter table public.service_job_lines drop constraint if exists service_job_lines_line_type_check;
alter table public.service_job_lines
  add constraint service_job_lines_line_type_check
  check (line_type in ('PACKAGE', 'SPECIFIC', 'CUSTOM', 'COMBO'));

-- A COMBO line references a combo and neither catalog table; the other three
-- keep their existing shapes exactly.
alter table public.service_job_lines drop constraint if exists service_job_lines_shape;
alter table public.service_job_lines
  add constraint service_job_lines_shape check (
    (line_type = 'PACKAGE' and general_service_package_id is not null and specific_service_id is null and combo_id is null)
    or (line_type = 'SPECIFIC' and specific_service_id is not null and general_service_package_id is null and combo_id is null)
    or (line_type = 'CUSTOM' and general_service_package_id is null and specific_service_id is null and combo_id is null)
    or (line_type = 'COMBO' and combo_id is not null and general_service_package_id is null and specific_service_id is null)
  );

create index if not exists service_job_lines_combo_idx on public.service_job_lines (combo_id) where combo_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Service inventory usage — parts that came free with a combo.
-- ---------------------------------------------------------------------------

alter table public.service_inventory_usage
  add column if not exists combo_id uuid references public.combos (id) on delete restrict;

alter table public.service_inventory_usage
  add column if not exists included_in_combo boolean not null default false;

-- ---------------------------------------------------------------------------
-- 3. Sale items — the same COMBO line type on the Sales side.
--
--    A combo sold here behaves exactly as it does on a Service Job, with one
--    difference inherited from Sales itself: stock deducts immediately rather
--    than at completion. The combo definition is untouched by that.
--
--    Fitting: a COMBO line never generates an INSTALLATION line. Ordinary
--    tyre sales are completely unaffected and still charge wheel_count x ₹300.
-- ---------------------------------------------------------------------------

alter table public.sale_items
  add column if not exists combo_id uuid references public.combos (id) on delete restrict;

alter table public.sale_items
  add column if not exists combo_contents text[];

alter table public.sale_items
  add column if not exists combo_list_value numeric(12, 2) check (combo_list_value is null or combo_list_value >= 0);

alter table public.sale_items
  add column if not exists included_in_combo boolean not null default false;

alter table public.sale_items drop constraint if exists sale_items_line_type_check;
alter table public.sale_items
  add constraint sale_items_line_type_check
  check (line_type in ('PRODUCT', 'INSTALLATION', 'COMBO'));

-- PRODUCT keeps its shape, but a combo's included products legitimately carry
-- unit_selling_price = 0 — the existing check already allows that (it requires
-- not-null, not positive), so no change is needed there.
alter table public.sale_items drop constraint if exists sale_items_combo_shape;
alter table public.sale_items
  add constraint sale_items_combo_shape check (
    line_type <> 'COMBO'
    or (combo_id is not null and description is not null and amount is not null and amount >= 0)
  );

-- line_total already routes anything that isn't PRODUCT through `amount`,
-- which is exactly right for a COMBO line — no change to the generated column.

create index if not exists sale_items_combo_idx on public.sale_items (combo_id) where combo_id is not null;

-- ---------------------------------------------------------------------------
-- 4. replace_service_job_lines() — extended for COMBO lines and for usage
--    rows that arrive already priced (a combo's included parts are ₹0, and
--    must not be re-priced from the item's current selling price).
--
--    Everything else is unchanged from 0016: same full-replace, same
--    catalog lookups, same deliberate absence of adjust_stock() (deduction
--    still happens exactly once, at completion).
-- ---------------------------------------------------------------------------

create or replace function public.replace_service_job_lines(
  p_job_id uuid,
  p_lines jsonb,
  p_usage jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line jsonb;
  v_usage jsonb;
  v_position integer := 0;
  v_line_type text;
  v_description text;
  v_quantity integer;
  v_rate numeric;
  v_package_id uuid;
  v_specific_id uuid;
  v_combo_id uuid;
  v_combo_contents text[];
  v_combo_list_value numeric;
  v_item_id uuid;
  v_item_name text;
  v_item_price numeric;
  v_qty_used integer;
  v_usage_combo_id uuid;
  v_included boolean;
  v_explicit_price numeric;
begin
  delete from public.service_job_lines where service_job_id = p_job_id;
  delete from public.service_inventory_usage where service_job_id = p_job_id;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    v_position := v_position + 1;
    v_line_type := v_line ->> 'line_type';
    v_quantity := coalesce((v_line ->> 'quantity')::integer, 1);
    v_package_id := null;
    v_specific_id := null;
    v_combo_id := null;
    v_combo_contents := null;
    v_combo_list_value := null;

    if v_line_type = 'PACKAGE' then
      v_package_id := (v_line ->> 'general_service_package_id')::uuid;
      select name, service_charge into v_description, v_rate
        from public.general_service_packages where id = v_package_id;
      if v_description is null then
        raise exception 'General Service Package % not found', v_package_id using errcode = 'P0002';
      end if;
      v_rate := coalesce((v_line ->> 'rate')::numeric, v_rate);

    elsif v_line_type = 'SPECIFIC' then
      v_specific_id := (v_line ->> 'specific_service_id')::uuid;
      select name, default_charge into v_description, v_rate
        from public.specific_services where id = v_specific_id;
      if v_description is null then
        raise exception 'Specific Service % not found', v_specific_id using errcode = 'P0002';
      end if;
      v_rate := coalesce((v_line ->> 'rate')::numeric, v_rate, 0);

    elsif v_line_type = 'CUSTOM' then
      v_description := nullif(btrim(coalesce(v_line ->> 'description', '')), '');
      if v_description is null then
        raise exception 'A description is required for a custom service line' using errcode = '22023';
      end if;
      v_rate := (v_line ->> 'rate')::numeric;
      if v_rate is null then
        raise exception 'A rate is required for a custom service line' using errcode = '22023';
      end if;

    elsif v_line_type = 'COMBO' then
      v_combo_id := (v_line ->> 'combo_id')::uuid;
      select name, combo_price into v_description, v_rate
        from public.combos where id = v_combo_id;
      if v_description is null then
        raise exception 'Combo % not found', v_combo_id using errcode = 'P0002';
      end if;
      -- Snapshotted, like every other price here: the offer may be retired or
      -- repriced tomorrow, and this job must keep showing what was charged.
      v_rate := coalesce((v_line ->> 'rate')::numeric, v_rate);
      v_combo_contents := coalesce(
        (select array_agg(value::text order by ordinality)
           from jsonb_array_elements_text(coalesce(v_line -> 'combo_contents', '[]'::jsonb)) with ordinality),
        '{}'
      );
      -- Computed here rather than trusted from the client, so the printed
      -- saving can't be inflated by a tampered request.
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

    else
      raise exception 'Unknown service line type %', v_line_type using errcode = '22023';
    end if;

    if v_quantity <= 0 then
      raise exception 'Quantity must be greater than zero' using errcode = '22023';
    end if;
    if v_rate < 0 then
      raise exception 'Rate cannot be negative' using errcode = '22023';
    end if;

    insert into public.service_job_lines
      (service_job_id, position, line_type, general_service_package_id, specific_service_id, combo_id, combo_contents, combo_list_value,
       description, quantity, rate)
    values
      (p_job_id, v_position, v_line_type, v_package_id, v_specific_id, v_combo_id, v_combo_contents, v_combo_list_value,
       v_description, v_quantity, v_rate);
  end loop;

  for v_usage in select * from jsonb_array_elements(coalesce(p_usage, '[]'::jsonb))
  loop
    v_item_id := (v_usage ->> 'inventory_item_id')::uuid;
    v_qty_used := (v_usage ->> 'quantity_used')::integer;
    v_usage_combo_id := nullif(v_usage ->> 'combo_id', '')::uuid;
    v_included := coalesce((v_usage ->> 'included_in_combo')::boolean, false);
    v_explicit_price := (v_usage ->> 'unit_price')::numeric;

    if v_qty_used is null or v_qty_used <= 0 then
      raise exception 'Quantity used must be greater than zero' using errcode = '22023';
    end if;

    select product_name, selling_price into v_item_name, v_item_price
      from public.inventory_items where id = v_item_id and is_active;
    if v_item_name is null then
      raise exception 'Inventory item % not found or inactive', v_item_id using errcode = 'P0002';
    end if;

    -- A part included in a combo is already paid for by the combo price, so
    -- it bills at zero. Everything else keeps the existing behaviour of
    -- snapshotting the item's current selling price.
    if v_included then
      v_item_price := 0;
    elsif v_explicit_price is not null then
      v_item_price := v_explicit_price;
    end if;

    if v_item_price < 0 then
      raise exception 'Unit price cannot be negative' using errcode = '22023';
    end if;

    insert into public.service_inventory_usage
      (service_job_id, inventory_item_id, item_name_snapshot, quantity_used, unit_price_snapshot, combo_id, included_in_combo)
    values
      (p_job_id, v_item_id, v_item_name, v_qty_used, v_item_price, v_usage_combo_id, v_included);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. record_sale() — extended with a COMBO line type.
--
--    Asymmetry with the Service side, and it's deliberate:
--
--    Service expands a combo *client-side*. A job stays editable while it's
--    open — staff routinely swap or drop a part the combo added — so the form
--    holds the full picture and replace_service_job_lines() persists whatever
--    it's given.
--
--    A Sale is recorded in one shot and is never edited afterwards, so the
--    combo is expanded *here*, server-side, from combo_components. The client
--    sends only the combo id and quantity; it cannot mis-state what was in the
--    bundle or quietly skip a stock deduction.
--
--    Everything not COMBO-related below is byte-identical to 0013.
-- ---------------------------------------------------------------------------

create or replace function public.record_sale(
  p_customer_name text,
  p_customer_mobile text,
  p_customer_address text,
  p_gst_applicable boolean,
  p_gst_amount numeric,
  p_discount_applicable boolean,
  p_discount_amount numeric,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_customer_id uuid;
  v_sale_id uuid;
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
  v_gst_amount numeric := coalesce(p_gst_amount, 0);
  v_discount_amount numeric := coalesce(p_discount_amount, 0);
  v_combo_id uuid;
  v_combo record;
  v_component record;
  v_component_qty integer;
  v_component_price numeric;
  v_combo_contents text[];
  v_combo_list_value numeric;
begin
  v_role := (auth.jwt() -> 'user_metadata' ->> 'role');
  if v_role is distinct from 'admin' and v_role is distinct from 'sales_person' then
    raise exception 'Not authorized to record sales' using errcode = '42501';
  end if;

  if p_customer_mobile is null or btrim(p_customer_mobile) = '' then
    raise exception 'Customer mobile number is required' using errcode = '22023';
  end if;
  if p_customer_name is null or btrim(p_customer_name) = '' then
    raise exception 'Customer name is required' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'A sale requires at least one line item' using errcode = '22023';
  end if;
  if v_gst_amount < 0 then
    raise exception 'GST amount cannot be negative' using errcode = '22023';
  end if;
  if v_discount_amount < 0 then
    raise exception 'Discount amount cannot be negative' using errcode = '22023';
  end if;

  select id into v_customer_id from public.customers where mobile_number = btrim(p_customer_mobile);
  if v_customer_id is null then
    insert into public.customers (name, mobile_number, address)
    values (btrim(p_customer_name), btrim(p_customer_mobile), nullif(btrim(p_customer_address), ''))
    returning id into v_customer_id;
  end if;

  insert into public.sales
    (customer_id, gst_applicable, gst_amount, discount_applicable, discount_amount,
     subtotal, installation_total, grand_total, invoice_number, created_by)
  values
    (v_customer_id, coalesce(p_gst_applicable, false), v_gst_amount,
     coalesce(p_discount_applicable, false), v_discount_amount,
     0, 0, 0, public.next_sales_invoice_number(), auth.uid())
  returning id into v_sale_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_position := v_position + 1;

    if (v_line ->> 'line_type') = 'PRODUCT' then
      v_product_count := v_product_count + 1;
      v_quantity := (v_line ->> 'quantity')::integer;

      if v_quantity is null or v_quantity <= 0 then
        raise exception 'Quantity must be greater than zero' using errcode = '22023';
      end if;

      select selling_price into v_unit_price
        from public.inventory_items
        where id = (v_line ->> 'inventory_item_id')::uuid and is_active;

      if v_unit_price is null then
        raise exception 'Inventory item % not found or inactive', v_line ->> 'inventory_item_id' using errcode = 'P0002';
      end if;

      insert into public.sale_items
        (sale_id, position, line_type, inventory_item_id, quantity, unit_selling_price)
      values
        (v_sale_id, v_position, 'PRODUCT', (v_line ->> 'inventory_item_id')::uuid, v_quantity, v_unit_price);

      v_subtotal := v_subtotal + (v_unit_price * v_quantity);

      perform public.adjust_stock((v_line ->> 'inventory_item_id')::uuid, -v_quantity, 'SALE', 'sales', null);

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
      -- Offer window checked against the IST calendar date, matching
      -- isComboAvailable() on the client — an offer must not expire early
      -- just because UTC has already rolled over.
      if v_combo.valid_from is not null and (now() at time zone 'Asia/Kolkata')::date < v_combo.valid_from then
        raise exception 'Combo "%" has not started yet', v_combo.name using errcode = '22023';
      end if;
      if v_combo.valid_to is not null and (now() at time zone 'Asia/Kolkata')::date > v_combo.valid_to then
        raise exception 'Combo "%" has ended', v_combo.name using errcode = '22023';
      end if;

      -- Contents are snapshotted as plain text for the printed breakdown, so
      -- editing the combo tomorrow never rewrites this invoice.
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
        (v_sale_id, v_position, 'COMBO', v_combo_id, v_combo_contents, v_combo_list_value, v_combo.name, v_amount, v_quantity);

      v_subtotal := v_subtotal + v_amount;

      -- Every inventory item inside the combo becomes its own stock-moving
      -- row. INCLUDED ones bill at ₹0 (the combo price already covers them);
      -- EXTRA ones bill normally on top. Either way stock moves, so
      -- getCostOfGoodsSold() picks up the real FIFO cost and the combo can
      -- never read as pure margin.
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
          (v_sale_id, v_position, 'PRODUCT', v_component.inventory_item_id, v_component_qty, v_component_price,
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
        (v_sale_id, v_position, 'INSTALLATION', v_subtype, v_wheel_count, v_description, v_amount, v_installed_by);

      v_installation_total := v_installation_total + v_amount;
    else
      raise exception 'Unknown line type %', v_line ->> 'line_type' using errcode = '22023';
    end if;
  end loop;

  -- A combo containing items satisfies this, so a combo-only sale is valid.
  if v_product_count = 0 then
    raise exception 'A sale requires at least one product line' using errcode = '22023';
  end if;

  update public.sales
    set subtotal = v_subtotal,
        installation_total = v_installation_total,
        grand_total = v_subtotal + v_installation_total + v_gst_amount - v_discount_amount
    where id = v_sale_id;

  return v_sale_id;
end;
$$;
