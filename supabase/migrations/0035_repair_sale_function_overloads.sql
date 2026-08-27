-- REPAIR: force the three sale-writing functions to a known-good state.
--
-- THE BUG THIS FIXES
-- A sale recorded with a negotiated line price (0034) was still billed at the
-- catalogue price: two tyres re-priced to Rs 2,300 each produced a server-side
-- total of Rs 3,700 (1,900 + 1,800 — the catalogue), and the payment was then
-- rejected as "more than the bill total".
--
-- ROOT CAUSE
-- `create or replace function` only replaces a function whose signature is
-- IDENTICAL. Every migration that added a parameter therefore created a NEW
-- function and left the old one in place:
--
--   record_sale              8 args (0013, 0022)  <- prices lines inline
--                            9 args (0024, 0026)  <- prices lines inline
--                           10 args (0029)        <- delegates, correct
--   record_sale_with_payment 11 args (0027)       <- calls the 9-arg one
--                           12 args (0029)        <- correct
--
-- Only the newest of each delegates to replace_sale_lines, which is the one
-- function that understands a per-line price. The older ones read
-- inventory_items.selling_price directly, so an override sent by the client
-- was silently discarded. Which overload PostgREST resolves to depends on its
-- cached schema, so the same request could work on one project and not on
-- another — exactly the drift seen here.
--
-- THE FIX
-- Drop EVERY overload of all three functions, whatever is currently
-- installed, then recreate the canonical versions from scratch. That makes
-- the outcome independent of which migrations were applied in which order, or
-- of any hand-editing done in the SQL editor since.
--
-- Safe to re-run: it drops by dynamic lookup, so a second run simply
-- reinstalls the same three functions.
--
-- NOTHING IS LOST: functions carry no data. Sales, invoices, stock movements
-- and payments are untouched — this only replaces the code that writes them.

-- ---------------------------------------------------------------------------
-- 1. Remove every version of the three functions
-- ---------------------------------------------------------------------------

do $$
declare
  v_fn record;
begin
  for v_fn in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('record_sale', 'record_sale_with_payment', 'replace_sale_lines')
  loop
    execute format('drop function if exists %s', v_fn.sig);
    raise notice 'dropped %', v_fn.sig;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Recreate them, newest logic only.
--    replace_sale_lines carries the per-line price override (0034);
--    record_sale and record_sale_with_payment both delegate to it, so there
--    is now exactly one place where a sale line is ever priced.
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

create or replace function public.record_sale(
  p_customer_name text,
  p_customer_mobile text,
  p_customer_address text,
  p_gst_applicable boolean,
  p_gst_amount numeric,
  p_discount_applicable boolean,
  p_discount_amount numeric,
  p_lines jsonb,
  p_payment_status text default 'PAID',
  p_sold_by_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
  v_sale_id uuid;
  v_gst_amount numeric := coalesce(p_gst_amount, 0);
  v_discount_amount numeric := coalesce(p_discount_amount, 0);
  v_payment_status text := coalesce(nullif(btrim(p_payment_status), ''), 'PAID');
begin
  if not public.has_sales_access() then
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
  if v_payment_status not in ('PENDING', 'PARTIAL', 'PAID') then
    raise exception 'Unknown payment status %', v_payment_status using errcode = '22023';
  end if;
  if p_sold_by_id is not null and not exists (
    select 1 from public.profiles p where p.id = p_sold_by_id and p.is_active
  ) then
    raise exception 'Sold by must be an active staff member' using errcode = '22023';
  end if;

  select id into v_customer_id from public.customers where mobile_number = btrim(p_customer_mobile);
  if v_customer_id is null then
    insert into public.customers (name, mobile_number, address)
    values (btrim(p_customer_name), btrim(p_customer_mobile), nullif(btrim(p_customer_address), ''))
    returning id into v_customer_id;
  end if;

  insert into public.sales
    (customer_id, gst_applicable, gst_amount, discount_applicable, discount_amount,
     subtotal, installation_total, grand_total, invoice_number, payment_status, created_by, sold_by_id)
  values
    (v_customer_id, coalesce(p_gst_applicable, false), v_gst_amount,
     coalesce(p_discount_applicable, false), v_discount_amount,
     0, 0, 0, public.next_sales_invoice_number(), v_payment_status, auth.uid(), p_sold_by_id)
  returning id into v_sale_id;

  -- Inserts every line, deducts stock, and writes the three totals.
  perform public.replace_sale_lines(v_sale_id, p_lines, false);

  return v_sale_id;
end;
$$;

create or replace function public.record_sale_with_payment(
  p_customer_name text,
  p_customer_mobile text,
  p_customer_address text,
  p_gst_applicable boolean,
  p_gst_amount numeric,
  p_discount_applicable boolean,
  p_discount_amount numeric,
  p_lines jsonb,
  p_payment_mode text,
  p_cash_amount numeric,
  p_upi_amount numeric,
  p_sold_by_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale_id uuid;
  v_grand_total numeric;
  v_cash numeric := round(coalesce(p_cash_amount, 0), 2);
  v_upi numeric := round(coalesce(p_upi_amount, 0), 2);
  v_mode text;
  v_status text;
begin
  if p_payment_mode is not null and p_payment_mode not in ('CASH', 'UPI', 'SPLIT') then
    raise exception 'Unknown payment mode %', p_payment_mode using errcode = '22023';
  end if;
  if v_cash < 0 or v_upi < 0 then
    raise exception 'Payment amounts cannot be negative' using errcode = '22023';
  end if;

  if p_payment_mode = 'CASH' then
    v_upi := 0;
  elsif p_payment_mode = 'UPI' then
    v_cash := 0;
  elsif p_payment_mode is null then
    v_cash := 0;
    v_upi := 0;
  end if;

  -- record_sale() does every validation and raises on anything invalid, so the
  -- sale either exists in full at this point or the whole transaction is gone.
  v_sale_id := public.record_sale(
    p_customer_name, p_customer_mobile, p_customer_address,
    p_gst_applicable, p_gst_amount, p_discount_applicable, p_discount_amount,
    p_lines, 'PENDING', p_sold_by_id
  );

  select grand_total into v_grand_total from public.sales where id = v_sale_id;

  if round(v_cash + v_upi, 2) > round(coalesce(v_grand_total, 0), 2) then
    raise exception 'Cash + UPI (%) is more than the bill total (%)',
      round(v_cash + v_upi, 2), round(coalesce(v_grand_total, 0), 2) using errcode = '22023';
  end if;

  v_mode := public.derive_payment_mode(v_cash, v_upi);
  v_status := public.derive_payment_status(v_cash, v_upi, v_grand_total);

  update public.sales
    set payment_mode = v_mode,
        cash_amount = v_cash,
        upi_amount = v_upi,
        payment_status = v_status
    where id = v_sale_id;

  return v_sale_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Grants. Dropping a function drops its grants with it, so these have to
--    be reissued or every call fails with "permission denied for function".
-- ---------------------------------------------------------------------------

grant execute on function public.replace_sale_lines(uuid, jsonb, boolean) to authenticated;

grant execute on function public.record_sale(
  text, text, text, boolean, numeric, boolean, numeric, jsonb, text, uuid
) to authenticated;

grant execute on function public.record_sale_with_payment(
  text, text, text, boolean, numeric, boolean, numeric, jsonb, text, numeric, numeric, uuid
) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Tell PostgREST to re-read the schema.
--
--    PostgREST caches which functions exist and resolves an overloaded call
--    against that cache. Having just changed the set of functions, a stale
--    cache would keep routing to a signature that no longer exists — this is
--    the documented way to refresh it without restarting the project.
-- ---------------------------------------------------------------------------

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 5. Verification — read this output.
--
--    EXPECTED: overloads_now = 1 on all three rows,
--    reaches_the_one_pricing_path = true on all three, and
--    honours_line_price = true on replace_sale_lines.
--    Any row showing overloads_now > 1 means a stale version came back.
-- ---------------------------------------------------------------------------

select p.proname,
       count(*) over (partition by p.proname)                        as overloads_now,
       pg_get_function_identity_arguments(p.oid)                     as signature,
       -- record_sale_with_payment reaches replace_sale_lines via record_sale,
       -- so accept either hop rather than reporting it as not delegating.
       position('replace_sale_lines' in p.prosrc) > 0
         or position('public.record_sale(' in p.prosrc) > 0
         or p.proname = 'replace_sale_lines'                         as reaches_the_one_pricing_path,
       position('v_override_price' in p.prosrc) > 0                  as honours_line_price
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('record_sale', 'record_sale_with_payment', 'replace_sale_lines')
 order by p.proname;
