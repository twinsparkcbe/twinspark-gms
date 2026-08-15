-- Mechanic role — access rollout (doc/mechanic-role-scope.md).
--
-- Adds a third role sitting between Administrator and Sales Person: a
-- Mechanic does everything a Sales Person does, plus the full Service Job
-- lifecycle — but not the Service Catalog, not service payment status, and
-- none of Dashboard/Inventory/Purchases/Reports/Settings.
--
-- Unlike 0020_user_roles_profiles.sql (which deliberately left every
-- SQL-level role check alone and kept `user_metadata.role` in sync as a
-- stopgap), this migration makes the SQL layer role-aware for real: every
-- function/policy that used to spell out `'admin'`/`'sales_person'` inline
-- now calls one of four helpers below. Adding or re-scoping a role after
-- this is a one-line change in a helper instead of another sweep across
-- fifteen migrations.
--
-- Function bodies below are the current-effective definitions copied
-- verbatim from their latest migration (0013/0016/0018/0022/0024) with only
-- the authorization guard rewritten — no behavioural change beyond access.

-- ---------------------------------------------------------------------------
-- 1. Role helpers. `stable`, not `volatile`, so the planner can cache them
--    per statement inside RLS policies; security invoker (they only read the
--    caller's own JWT, nothing privileged).
-- ---------------------------------------------------------------------------

create or replace function public.jwt_role()
returns text
language sql
stable
set search_path = public
as $$
  select (auth.jwt() -> 'user_metadata' ->> 'role');
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = public
as $$
  select public.jwt_role() = 'admin';
$$;

-- Sales, Billing, Customers and Online Orders — every staff role.
create or replace function public.has_sales_access()
returns boolean
language sql
stable
set search_path = public
as $$
  select public.jwt_role() in ('admin', 'sales_person', 'mechanic');
$$;

-- Service Job lifecycle + Vehicles. Sales Person is deliberately absent.
create or replace function public.has_service_access()
returns boolean
language sql
stable
set search_path = public
as $$
  select public.jwt_role() in ('admin', 'mechanic');
$$;

grant execute on function public.jwt_role() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.has_sales_access() to authenticated;
grant execute on function public.has_service_access() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Assigned mechanic on a Service Job. Informational, not an access gate —
--    any Mechanic can still open any job. `on delete set null` rather than
--    restrict: deleting a staff account should never be blocked by, or
--    cascade into, historical job records.
-- ---------------------------------------------------------------------------

alter table public.service_jobs
  add column if not exists assigned_mechanic_id uuid references public.profiles (id) on delete set null;

create index if not exists service_jobs_assigned_mechanic_idx
  on public.service_jobs (assigned_mechanic_id, created_at desc);

-- Staff need to read each other's names now: the Service list joins the
-- assigned mechanic's profile, and the assignment picker lists active
-- Mechanics. `profiles_select_own` (0020) only ever exposed the caller's own
-- row. This policy reads the JWT, not `profiles`, so it can't recurse.
drop policy if exists "profiles_select_staff" on public.profiles;
create policy "profiles_select_staff" on public.profiles
  for select using (public.has_service_access());

-- ---------------------------------------------------------------------------
-- 3. Functions — verbatim bodies, guards rewritten to use the helpers.
--    create_service_job()/update_service_job() also gain a trailing
--    p_assigned_mechanic_id parameter, so their old signatures are dropped
--    first (a changed argument list can't go through create or replace).
-- ---------------------------------------------------------------------------

drop function if exists public.create_service_job(
  text, text, text, text, text, integer, text, text, timestamptz, boolean, numeric, boolean, numeric, jsonb, jsonb
);
drop function if exists public.update_service_job(
  uuid, text, text, text, text, text, integer, text, text, timestamptz, boolean, numeric, boolean, numeric, jsonb, jsonb
);

create or replace function public.adjust_stock(
  p_item_id uuid,
  p_delta integer,
  p_reason public.stock_movement_reason,
  p_source_module text,
  p_note text default null,
  p_purchase_entry_id uuid default null,
  p_unit_cost numeric default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_new_balance integer;
  v_cost numeric;
  v_batch record;
  v_remaining_to_consume integer;
  v_take integer;
begin
  if p_delta = 0 then
    raise exception 'Adjustment quantity cannot be zero' using errcode = '22023';
  end if;

  v_role := (auth.jwt() -> 'user_metadata' ->> 'role');

  -- Admin-only reasons: Purchases, Purchase Returns, Sale Returns, and any
  -- manual correction/damage write-off.
  if p_reason in ('PURCHASE', 'PURCHASE_RETURN', 'SALE_RETURN', 'MANUAL_CORRECTION', 'DAMAGE')
     and not public.is_admin() then
    raise exception 'Only Administrators can record % stock movements', p_reason
      using errcode = '42501';
  end if;

  -- Admin or Mechanic: parts consumed by a Service Job. A Mechanic
  -- completing a job is exactly what deducts these (0026 — Mechanic role).
  if p_reason = 'SERVICE_USAGE' and not public.has_service_access() then
    raise exception 'Not authorized to record % stock movements', p_reason
      using errcode = '42501';
  end if;

  -- Admin, Sales Person or Mechanic: Sales and Online Order dispatch.
  if p_reason in ('SALE', 'ONLINE_ORDER_DISPATCH')
     and not public.has_sales_access() then
    raise exception 'Not authorized to record % stock movements', p_reason
      using errcode = '42501';
  end if;

  if p_reason in ('MANUAL_CORRECTION', 'DAMAGE', 'PURCHASE_RETURN', 'SALE_RETURN') and (p_note is null or btrim(p_note) = '') then
    raise exception 'A note is required for % adjustments', p_reason
      using errcode = '22023';
  end if;

  if p_delta > 0 then
    -- An increase always needs a batch — create a synthetic one if the
    -- caller didn't already create/identify one. Sale Return deliberately
    -- restocks via a synthetic batch at the item's most recent cost rather
    -- than reconstructing which exact original batch(es) a FIFO-split sale
    -- drew from — simpler, and correct enough for a floor-level correction.
    if p_purchase_entry_id is null then
      v_cost := p_unit_cost;
      if v_cost is null then
        select unit_price into v_cost
          from public.purchase_entries
          where inventory_item_id = p_item_id
          order by purchase_date desc, created_at desc
          limit 1;
      end if;
      v_cost := coalesce(v_cost, 0);

      insert into public.purchase_entries
        (inventory_item_id, quantity, unit_price, remaining_quantity, selling_price, supplier_name, purchase_date, note, created_by, batch_number)
      values
        (p_item_id, p_delta, v_cost, p_delta,
         coalesce((select selling_price from public.inventory_items where id = p_item_id), v_cost),
         null, now(), p_note, auth.uid(), public.next_batch_number())
      returning id into p_purchase_entry_id;
    end if;

    update public.inventory_items
      set available_quantity = available_quantity + p_delta
      where id = p_item_id
      returning available_quantity into v_new_balance;

    if not found then
      raise exception 'Item % not found', p_item_id using errcode = 'P0002';
    end if;

    insert into public.stock_movements
      (inventory_item_id, delta, resulting_balance, reason, source_module, note, created_by, purchase_entry_id)
    values
      (p_item_id, p_delta, v_new_balance, p_reason, p_source_module, p_note, auth.uid(), p_purchase_entry_id);

  elsif p_purchase_entry_id is not null then
    -- Explicit single-batch decrease (Purchase Return). Race-safe: the
    -- WHERE clause re-checks the batch's remaining_quantity at write time.
    update public.purchase_entries
      set remaining_quantity = remaining_quantity + p_delta
      where id = p_purchase_entry_id
        and remaining_quantity + p_delta >= 0
      returning inventory_item_id into p_item_id;

    if not found then
      raise exception 'Insufficient remaining quantity on this batch' using errcode = 'P0001';
    end if;

    update public.inventory_items
      set available_quantity = available_quantity + p_delta
      where id = p_item_id
        and available_quantity + p_delta >= 0
      returning available_quantity into v_new_balance;

    if not found then
      raise exception 'Insufficient stock, or item % not found', p_item_id using errcode = 'P0001';
    end if;

    insert into public.stock_movements
      (inventory_item_id, delta, resulting_balance, reason, source_module, note, created_by, purchase_entry_id)
    values
      (p_item_id, p_delta, v_new_balance, p_reason, p_source_module, p_note, auth.uid(), p_purchase_entry_id);

  else
    -- FIFO: drain oldest batches first, splitting across as many as needed.
    -- Used by SALE (and, later, SERVICE_USAGE/ONLINE_ORDER_DISPATCH/DAMAGE/
    -- negative MANUAL_CORRECTION) — Sales gets this for free, no new logic.
    v_remaining_to_consume := -p_delta;

    for v_batch in
      select id, remaining_quantity
        from public.purchase_entries
        where inventory_item_id = p_item_id and remaining_quantity > 0
        order by purchase_date asc, created_at asc
        for update
    loop
      exit when v_remaining_to_consume <= 0;

      v_take := least(v_batch.remaining_quantity, v_remaining_to_consume);

      update public.purchase_entries
        set remaining_quantity = remaining_quantity - v_take
        where id = v_batch.id;

      update public.inventory_items
        set available_quantity = available_quantity - v_take
        where id = p_item_id
        returning available_quantity into v_new_balance;

      if not found then
        raise exception 'Item % not found', p_item_id using errcode = 'P0002';
      end if;

      insert into public.stock_movements
        (inventory_item_id, delta, resulting_balance, reason, source_module, note, created_by, purchase_entry_id)
      values
        (p_item_id, -v_take, v_new_balance, p_reason, p_source_module, p_note, auth.uid(), v_batch.id);

      v_remaining_to_consume := v_remaining_to_consume - v_take;
    end loop;

    if v_remaining_to_consume > 0 then
      raise exception 'Insufficient stock, or item % not found', p_item_id using errcode = 'P0001';
    end if;
  end if;

  return v_new_balance;
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
  p_payment_status text default 'PAID'
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
  v_payment_status text := coalesce(nullif(btrim(p_payment_status), ''), 'PAID');
  v_combo_id uuid;
  v_combo record;
  v_component record;
  v_component_qty integer;
  v_component_price numeric;
  v_combo_contents text[];
  v_combo_list_value numeric;
begin
  v_role := (auth.jwt() -> 'user_metadata' ->> 'role');
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

  select id into v_customer_id from public.customers where mobile_number = btrim(p_customer_mobile);
  if v_customer_id is null then
    insert into public.customers (name, mobile_number, address)
    values (btrim(p_customer_name), btrim(p_customer_mobile), nullif(btrim(p_customer_address), ''))
    returning id into v_customer_id;
  end if;

  insert into public.sales
    (customer_id, gst_applicable, gst_amount, discount_applicable, discount_amount,
     subtotal, installation_total, grand_total, invoice_number, payment_status, created_by)
  values
    (v_customer_id, coalesce(p_gst_applicable, false), v_gst_amount,
     coalesce(p_discount_applicable, false), v_discount_amount,
     0, 0, 0, public.next_sales_invoice_number(), v_payment_status, auth.uid())
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
        (v_sale_id, v_position, 'COMBO', v_combo_id, v_combo_contents, v_combo_list_value, v_combo.name, v_amount, v_quantity);

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

create or replace function public.escalate_sale_to_service(
  p_sale_id uuid,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_has_installation boolean;
begin
  v_role := (auth.jwt() -> 'user_metadata' ->> 'role');
  if not public.has_sales_access() then
    raise exception 'Not authorized to escalate sales to Service' using errcode = '42501';
  end if;

  select exists(
    select 1 from public.sale_items where sale_id = p_sale_id and line_type = 'INSTALLATION'
  ) into v_has_installation;

  if not v_has_installation then
    raise exception 'Only a sale with at least one installation line can be escalated to Service' using errcode = '22023';
  end if;

  update public.sales
    set needs_service_followup = true,
        service_followup_note = nullif(btrim(coalesce(p_note, '')), '')
    where id = p_sale_id;

  if not found then
    raise exception 'Sale % not found', p_sale_id using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.update_sales_payment_status(
  p_sale_id uuid,
  p_payment_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  v_role := (auth.jwt() -> 'user_metadata' ->> 'role');
  if not public.has_sales_access() then
    raise exception 'Not authorized to update a sale' using errcode = '42501';
  end if;
  if p_payment_status not in ('PENDING', 'PARTIAL', 'PAID') then
    raise exception 'Unknown payment status %', p_payment_status using errcode = '22023';
  end if;

  update public.sales set payment_status = p_payment_status where id = p_sale_id;

  if not found then
    raise exception 'Sale % not found', p_sale_id using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.verify_online_order_payment(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  v_role := (auth.jwt() -> 'user_metadata' ->> 'role');
  if not public.has_sales_access() then
    raise exception 'Not authorized to verify online order payments' using errcode = '42501';
  end if;

  update public.online_orders
    set status = 'PAYMENT_VERIFIED', verified_by = auth.uid(), verified_at = now()
    where id = p_order_id and status = 'SUBMITTED';

  if not found then
    raise exception 'Order % not found, or not awaiting payment verification', p_order_id using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.approve_online_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  v_role := (auth.jwt() -> 'user_metadata' ->> 'role');
  if not public.has_sales_access() then
    raise exception 'Not authorized to approve online orders' using errcode = '42501';
  end if;

  update public.online_orders
    set status = 'APPROVED', approved_by = auth.uid(), approved_at = now()
    where id = p_order_id and status = 'PAYMENT_VERIFIED';

  if not found then
    raise exception 'Order % not found, or payment has not been verified yet', p_order_id using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.dispatch_online_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_order record;
  v_front_item_id uuid;
  v_back_item_id uuid;
begin
  v_role := (auth.jwt() -> 'user_metadata' ->> 'role');
  if not public.has_sales_access() then
    raise exception 'Not authorized to dispatch online orders' using errcode = '42501';
  end if;

  select id, quantity_front, quantity_back into v_order
    from public.online_orders
    where id = p_order_id and status = 'APPROVED'
    for update;

  if not found then
    raise exception 'Order % not found, or not yet approved', p_order_id using errcode = 'P0002';
  end if;

  if v_order.quantity_front > 0 then
    select id into v_front_item_id
      from public.inventory_items
      where item_type = 'TRACK_TYRE' and product_name = 'Track Tyre - Front' and is_active = true
      order by created_at desc
      limit 1;

    if v_front_item_id is null then
      raise exception 'No active "Track Tyre - Front" inventory item exists' using errcode = 'P0002';
    end if;

    perform public.adjust_stock(
      v_front_item_id, -v_order.quantity_front, 'ONLINE_ORDER_DISPATCH', 'online-orders',
      'Online Order ' || p_order_id || ' dispatch (Front)'
    );
  end if;

  if v_order.quantity_back > 0 then
    select id into v_back_item_id
      from public.inventory_items
      where item_type = 'TRACK_TYRE' and product_name = 'Track Tyre - Back' and is_active = true
      order by created_at desc
      limit 1;

    if v_back_item_id is null then
      raise exception 'No active "Track Tyre - Back" inventory item exists' using errcode = 'P0002';
    end if;

    perform public.adjust_stock(
      v_back_item_id, -v_order.quantity_back, 'ONLINE_ORDER_DISPATCH', 'online-orders',
      'Online Order ' || p_order_id || ' dispatch (Back)'
    );
  end if;

  update public.online_orders
    set status = 'DISPATCHED', dispatched_by = auth.uid(), dispatched_at = now()
    where id = p_order_id;
end;
$$;

create or replace function public.reject_online_order(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  v_role := (auth.jwt() -> 'user_metadata' ->> 'role');
  if not public.has_sales_access() then
    raise exception 'Not authorized to reject online orders' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required to reject an order' using errcode = '22023';
  end if;

  update public.online_orders
    set status = 'REJECTED', rejected_by = auth.uid(), rejected_at = now(), rejection_reason = btrim(p_reason)
    where id = p_order_id and status in ('SUBMITTED', 'PAYMENT_VERIFIED');

  if not found then
    raise exception 'Order % not found, or already past the point it can be rejected', p_order_id using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.create_service_job(
  p_customer_name text,
  p_customer_mobile text,
  p_customer_address text,
  p_vehicle_number text,
  p_vehicle_model text,
  p_odometer_reading integer,
  p_complaint_notes text,
  p_mechanic_notes text,
  p_expected_delivery_at timestamptz,
  p_gst_applicable boolean,
  p_gst_amount numeric,
  p_discount_applicable boolean,
  p_discount_amount numeric,
  p_lines jsonb,
  p_usage jsonb,
  p_assigned_mechanic_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_customer_id uuid;
  v_vehicle_id uuid;
  v_job_id uuid;
begin
  v_role := (auth.jwt() -> 'user_metadata' ->> 'role');
  if not public.has_service_access() then
    raise exception 'Not authorized to create Service Jobs' using errcode = '42501';
  end if;

  if p_assigned_mechanic_id is not null and not exists (
    select 1 from public.profiles p
    where p.id = p_assigned_mechanic_id and p.role = 'mechanic' and p.is_active
  ) then
    raise exception 'Assigned user must be an active Mechanic' using errcode = '22023';
  end if;

  if p_customer_mobile is null or btrim(p_customer_mobile) = '' then
    raise exception 'Customer mobile number is required' using errcode = '22023';
  end if;
  if p_customer_name is null or btrim(p_customer_name) = '' then
    raise exception 'Customer name is required' using errcode = '22023';
  end if;
  if p_vehicle_number is null or btrim(p_vehicle_number) = '' then
    raise exception 'Vehicle number is required' using errcode = '22023';
  end if;
  if p_vehicle_model is null or btrim(p_vehicle_model) = '' then
    raise exception 'Vehicle model is required' using errcode = '22023';
  end if;
  if p_odometer_reading is null or p_odometer_reading < 0 then
    raise exception 'A valid odometer reading is required' using errcode = '22023';
  end if;

  -- Find-or-create Customer by mobile number, same key Sales already uses.
  select id into v_customer_id from public.customers where mobile_number = btrim(p_customer_mobile);
  if v_customer_id is null then
    insert into public.customers (name, mobile_number, address)
    values (btrim(p_customer_name), btrim(p_customer_mobile), nullif(btrim(p_customer_address), ''))
    returning id into v_customer_id;
  end if;

  -- Find-or-create Vehicle by registration number (case-insensitive). A
  -- match under a *different* customer is treated as an ownership transfer
  -- (used bike resold) — re-pointed at the current customer rather than
  -- blocked, since vehicle_number has no uniqueness constraint to begin
  -- with (see the table comment above).
  select id into v_vehicle_id from public.vehicles where lower(vehicle_number) = lower(btrim(p_vehicle_number));
  if v_vehicle_id is null then
    insert into public.vehicles (customer_id, vehicle_number, vehicle_model, latest_odometer_reading)
    values (v_customer_id, btrim(p_vehicle_number), btrim(p_vehicle_model), p_odometer_reading)
    returning id into v_vehicle_id;
  else
    update public.vehicles
      set customer_id = v_customer_id,
          vehicle_model = btrim(p_vehicle_model),
          latest_odometer_reading = p_odometer_reading
      where id = v_vehicle_id;
  end if;

  insert into public.service_jobs
    (job_number, customer_id, vehicle_id, odometer_reading, status, complaint_notes, mechanic_notes,
     expected_delivery_at, gst_applicable, gst_amount, discount_applicable, discount_amount, created_by, assigned_mechanic_id)
  values
    (public.next_service_job_number(), v_customer_id, v_vehicle_id, p_odometer_reading, 'DRAFT',
     nullif(btrim(coalesce(p_complaint_notes, '')), ''), nullif(btrim(coalesce(p_mechanic_notes, '')), ''),
     p_expected_delivery_at, coalesce(p_gst_applicable, false), coalesce(p_gst_amount, 0),
     coalesce(p_discount_applicable, false), coalesce(p_discount_amount, 0), auth.uid(), p_assigned_mechanic_id)
  returning id into v_job_id;

  perform public.replace_service_job_lines(v_job_id, p_lines, p_usage);
  perform public.recompute_service_job_totals(v_job_id);

  insert into public.service_job_events (service_job_id, event_type, detail, created_by)
  values (v_job_id, 'JOB_CREATED', 'Service Job created', auth.uid());

  return v_job_id;
end;
$$;

create or replace function public.update_service_job(
  p_service_job_id uuid,
  p_customer_name text,
  p_customer_mobile text,
  p_customer_address text,
  p_vehicle_number text,
  p_vehicle_model text,
  p_odometer_reading integer,
  p_complaint_notes text,
  p_mechanic_notes text,
  p_expected_delivery_at timestamptz,
  p_gst_applicable boolean,
  p_gst_amount numeric,
  p_discount_applicable boolean,
  p_discount_amount numeric,
  p_lines jsonb,
  p_usage jsonb,
  p_assigned_mechanic_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_status text;
  v_customer_id uuid;
  v_vehicle_id uuid;
begin
  v_role := (auth.jwt() -> 'user_metadata' ->> 'role');
  if not public.has_service_access() then
    raise exception 'Not authorized to edit Service Jobs' using errcode = '42501';
  end if;

  if p_assigned_mechanic_id is not null and not exists (
    select 1 from public.profiles p
    where p.id = p_assigned_mechanic_id and p.role = 'mechanic' and p.is_active
  ) then
    raise exception 'Assigned user must be an active Mechanic' using errcode = '22023';
  end if;

  select status into v_status from public.service_jobs where id = p_service_job_id for update;
  if not found then
    raise exception 'Service Job % not found', p_service_job_id using errcode = 'P0002';
  end if;
  if v_status not in ('DRAFT', 'IN_PROGRESS') then
    raise exception 'A Service Job can only be edited while Draft or In Progress' using errcode = '22023';
  end if;

  if p_customer_mobile is null or btrim(p_customer_mobile) = '' then
    raise exception 'Customer mobile number is required' using errcode = '22023';
  end if;
  if p_vehicle_number is null or btrim(p_vehicle_number) = '' then
    raise exception 'Vehicle number is required' using errcode = '22023';
  end if;
  if p_odometer_reading is null or p_odometer_reading < 0 then
    raise exception 'A valid odometer reading is required' using errcode = '22023';
  end if;

  select id into v_customer_id from public.customers where mobile_number = btrim(p_customer_mobile);
  if v_customer_id is null then
    insert into public.customers (name, mobile_number, address)
    values (btrim(p_customer_name), btrim(p_customer_mobile), nullif(btrim(p_customer_address), ''))
    returning id into v_customer_id;
  end if;

  select id into v_vehicle_id from public.vehicles where lower(vehicle_number) = lower(btrim(p_vehicle_number));
  if v_vehicle_id is null then
    insert into public.vehicles (customer_id, vehicle_number, vehicle_model, latest_odometer_reading)
    values (v_customer_id, btrim(p_vehicle_number), btrim(p_vehicle_model), p_odometer_reading)
    returning id into v_vehicle_id;
  else
    update public.vehicles
      set customer_id = v_customer_id,
          vehicle_model = btrim(p_vehicle_model),
          latest_odometer_reading = p_odometer_reading
      where id = v_vehicle_id;
  end if;

  update public.service_jobs
    set customer_id = v_customer_id,
        vehicle_id = v_vehicle_id,
        odometer_reading = p_odometer_reading,
        complaint_notes = nullif(btrim(coalesce(p_complaint_notes, '')), ''),
        mechanic_notes = nullif(btrim(coalesce(p_mechanic_notes, '')), ''),
        expected_delivery_at = p_expected_delivery_at,
        gst_applicable = coalesce(p_gst_applicable, false),
        gst_amount = coalesce(p_gst_amount, 0),
        discount_applicable = coalesce(p_discount_applicable, false),
        discount_amount = coalesce(p_discount_amount, 0),
        assigned_mechanic_id = p_assigned_mechanic_id
    where id = p_service_job_id;

  perform public.replace_service_job_lines(p_service_job_id, p_lines, p_usage);
  perform public.recompute_service_job_totals(p_service_job_id);
end;
$$;

create or replace function public.update_service_job_status(
  p_service_job_id uuid,
  p_new_status text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_current text;
  v_valid boolean := false;
begin
  v_role := (auth.jwt() -> 'user_metadata' ->> 'role');
  if not public.has_service_access() then
    raise exception 'Not authorized to change a Service Job''s status' using errcode = '42501';
  end if;

  if p_new_status = 'COMPLETED' then
    raise exception 'Use complete_service_job() to finalize a job' using errcode = '22023';
  end if;
  if p_new_status not in ('DRAFT', 'IN_PROGRESS', 'READY_FOR_DELIVERY', 'CANCELLED') then
    raise exception 'Unknown status %', p_new_status using errcode = '22023';
  end if;

  select status into v_current from public.service_jobs where id = p_service_job_id for update;
  if not found then
    raise exception 'Service Job % not found', p_service_job_id using errcode = 'P0002';
  end if;

  if v_current = p_new_status then
    v_valid := true; -- no-op, tolerated
  elsif p_new_status = 'CANCELLED' then
    v_valid := v_current in ('DRAFT', 'IN_PROGRESS', 'READY_FOR_DELIVERY');
  elsif v_current = 'DRAFT' and p_new_status = 'IN_PROGRESS' then
    v_valid := true;
  elsif v_current = 'IN_PROGRESS' and p_new_status = 'READY_FOR_DELIVERY' then
    v_valid := true;
  end if;

  if not v_valid then
    raise exception 'Cannot move a Service Job from % to %', v_current, p_new_status using errcode = '22023';
  end if;

  update public.service_jobs set status = p_new_status where id = p_service_job_id;

  insert into public.service_job_events (service_job_id, event_type, detail, created_by)
  values (
    p_service_job_id,
    'STATUS_CHANGED',
    v_current || ' → ' || p_new_status || coalesce(' (' || nullif(btrim(p_note), '') || ')', ''),
    auth.uid()
  );
end;
$$;

create or replace function public.complete_service_job(p_service_job_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_status text;
  v_line_count integer;
  v_usage record;
  v_invoice_number text;
  v_subtotal numeric;
  v_inventory_total numeric;
  v_gst numeric;
  v_discount numeric;
begin
  v_role := (auth.jwt() -> 'user_metadata' ->> 'role');
  if not public.has_service_access() then
    raise exception 'Not authorized to complete a Service Job' using errcode = '42501';
  end if;

  select status into v_status from public.service_jobs where id = p_service_job_id for update;
  if not found then
    raise exception 'Service Job % not found', p_service_job_id using errcode = 'P0002';
  end if;
  if v_status not in ('IN_PROGRESS', 'READY_FOR_DELIVERY') then
    raise exception 'A Service Job can only be completed from In Progress or Ready for Delivery' using errcode = '22023';
  end if;

  select count(*) into v_line_count from public.service_job_lines where service_job_id = p_service_job_id;
  if v_line_count = 0 then
    raise exception 'A Service Job needs at least one service line before it can be completed' using errcode = '22023';
  end if;

  -- FIFO-consumes each usage row via the existing shared stock path — the
  -- SAME function Purchases/Sales already use, reason SERVICE_USAGE
  -- (already a valid enum value, already admin-gated). Any insufficient-
  -- stock raise here aborts this entire function (job stays exactly as it
  -- was), same guarantee record_sale() gives Sales.
  for v_usage in
    select id, inventory_item_id, quantity_used
      from public.service_inventory_usage
      where service_job_id = p_service_job_id and not stock_deducted
      for update
  loop
    perform public.adjust_stock(v_usage.inventory_item_id, -v_usage.quantity_used, 'SERVICE_USAGE', 'service', null);
    update public.service_inventory_usage set stock_deducted = true where id = v_usage.id;
  end loop;

  select coalesce(sum(amount), 0) into v_subtotal from public.service_job_lines where service_job_id = p_service_job_id;
  select coalesce(sum(line_total), 0) into v_inventory_total from public.service_inventory_usage where service_job_id = p_service_job_id;
  select gst_amount, discount_amount into v_gst, v_discount from public.service_jobs where id = p_service_job_id;

  v_invoice_number := public.next_service_invoice_number();

  update public.service_jobs
    set status = 'COMPLETED',
        invoice_number = v_invoice_number,
        completed_at = now(),
        payment_status = 'PENDING',
        delivery_status = 'WAITING',
        subtotal = v_subtotal,
        inventory_total = v_inventory_total,
        grand_total = v_subtotal + v_inventory_total + coalesce(v_gst, 0) - coalesce(v_discount, 0)
    where id = p_service_job_id;

  insert into public.service_job_events (service_job_id, event_type, detail, created_by)
  values (p_service_job_id, 'JOB_COMPLETED', 'Invoice ' || v_invoice_number || ' generated', auth.uid());

  return v_invoice_number;
end;
$$;

create or replace function public.update_service_delivery_status(
  p_service_job_id uuid,
  p_delivery_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_status text;
begin
  v_role := (auth.jwt() -> 'user_metadata' ->> 'role');
  if not public.has_service_access() then
    raise exception 'Not authorized to update delivery status' using errcode = '42501';
  end if;
  if p_delivery_status not in ('WAITING', 'READY_FOR_PICKUP', 'DELIVERED') then
    raise exception 'Unknown delivery status %', p_delivery_status using errcode = '22023';
  end if;

  select status into v_status from public.service_jobs where id = p_service_job_id for update;
  if not found then
    raise exception 'Service Job % not found', p_service_job_id using errcode = 'P0002';
  end if;
  if v_status <> 'COMPLETED' then
    raise exception 'Delivery status can only be set on a Completed Service Job' using errcode = '22023';
  end if;

  update public.service_jobs
    set delivery_status = p_delivery_status,
        delivered_at = case when p_delivery_status = 'DELIVERED' then now() else delivered_at end
    where id = p_service_job_id;

  insert into public.service_job_events (service_job_id, event_type, detail, created_by)
  values (p_service_job_id, 'DELIVERY_STATUS_CHANGED', p_delivery_status, auth.uid());
end;
$$;

grant execute on function public.create_service_job(
  text, text, text, text, text, integer, text, text, timestamptz, boolean, numeric, boolean, numeric, jsonb, jsonb, uuid
) to authenticated;

grant execute on function public.update_service_job(
  uuid, text, text, text, text, text, integer, text, text, timestamptz, boolean, numeric, boolean, numeric, jsonb, jsonb, uuid
) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Policies. Every one below is a drop-and-recreate of an existing policy
--    with the same intent — only the role predicate changes. Names are kept
--    even where "admin" is now a misnomer (e.g. vehicles_admin_select), so
--    this stays a one-to-one, greppable mapping against 0013/0016/0017/0018/
--    0021 rather than a rename sweep.
--
--    Untouched, still Admin-only: every inventory/purchase policy,
--    stock_movements_admin_select, sale_returns_admin_select, and all
--    catalog INSERT/UPDATE policies (a Mechanic reads the price list, never
--    edits it).
-- ---------------------------------------------------------------------------

-- Sales side — now every staff role (0013).
drop policy if exists "customers_read" on public.customers;
create policy "customers_read" on public.customers
  for select using (public.has_sales_access());

drop policy if exists "sales_read" on public.sales;
create policy "sales_read" on public.sales
  for select using (public.has_sales_access());

drop policy if exists "sale_items_read" on public.sale_items;
create policy "sale_items_read" on public.sale_items
  for select using (public.has_sales_access());

-- Online Orders (0018).
drop policy if exists "online_orders_staff_read" on public.online_orders;
create policy "online_orders_staff_read" on public.online_orders
  for select using (public.has_sales_access());

drop policy if exists "online_order_screenshots_staff_select" on storage.objects;
create policy "online_order_screenshots_staff_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'online-order-screenshots' and public.has_sales_access());

-- Combo Offers (0021) — read-only for staff; writes stay Admin-only.
drop policy if exists "combos_select_staff" on public.combos;
create policy "combos_select_staff" on public.combos
  for select using (public.has_sales_access());

drop policy if exists "combo_components_select_staff" on public.combo_components;
create policy "combo_components_select_staff" on public.combo_components
  for select using (public.has_sales_access());

-- Service side — Admin + Mechanic (0016/0017).
drop policy if exists "vehicles_admin_select" on public.vehicles;
create policy "vehicles_admin_select" on public.vehicles
  for select using (public.has_service_access());

drop policy if exists "service_jobs_admin_select" on public.service_jobs;
create policy "service_jobs_admin_select" on public.service_jobs
  for select using (public.has_service_access());

drop policy if exists "service_job_lines_admin_select" on public.service_job_lines;
create policy "service_job_lines_admin_select" on public.service_job_lines
  for select using (public.has_service_access());

drop policy if exists "service_inventory_usage_admin_select" on public.service_inventory_usage;
create policy "service_inventory_usage_admin_select" on public.service_inventory_usage
  for select using (public.has_service_access());

drop policy if exists "service_job_events_admin_select" on public.service_job_events;
create policy "service_job_events_admin_select" on public.service_job_events
  for select using (public.has_service_access());

drop policy if exists "service_job_images_admin_select" on public.service_job_images;
create policy "service_job_images_admin_select" on public.service_job_images
  for select using (public.has_service_access());

drop policy if exists "service_job_images_admin_insert" on public.service_job_images;
create policy "service_job_images_admin_insert" on public.service_job_images
  for insert with check (public.has_service_access());

drop policy if exists "service_job_images_admin_delete" on public.service_job_images;
create policy "service_job_images_admin_delete" on public.service_job_images
  for delete using (public.has_service_access());

-- Catalog reads only — a Mechanic picks packages/services when building a
-- job. The matching INSERT/UPDATE policies from 0016/0017 are left alone.
drop policy if exists "general_service_packages_admin_select" on public.general_service_packages;
create policy "general_service_packages_admin_select" on public.general_service_packages
  for select using (public.has_service_access());

drop policy if exists "specific_services_admin_select" on public.specific_services;
create policy "specific_services_admin_select" on public.specific_services
  for select using (public.has_service_access());

drop policy if exists "general_service_package_items_admin_select" on public.general_service_package_items;
create policy "general_service_package_items_admin_select" on public.general_service_package_items
  for select using (public.has_service_access());

drop policy if exists "specific_service_items_admin_select" on public.specific_service_items;
create policy "specific_service_items_admin_select" on public.specific_service_items
  for select using (public.has_service_access());

-- Service job photos in storage (0016).
drop policy if exists "service_job_images_admin_insert" on storage.objects;
create policy "service_job_images_admin_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'service-job-images' and public.has_service_access());

drop policy if exists "service_job_images_admin_update" on storage.objects;
create policy "service_job_images_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'service-job-images' and public.has_service_access());

drop policy if exists "service_job_images_admin_delete" on storage.objects;
create policy "service_job_images_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'service-job-images' and public.has_service_access());
