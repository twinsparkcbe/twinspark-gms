-- Sales — Edit Sale, Void Sale, and Sold By.
-- doc/sales-edit-void-scope.md.
--
-- A sale has been immutable since 0013. The only correction available was a
-- Sale Return, which is a different business event — a customer physically
-- bringing goods back — so using it to fix a keying mistake left a phantom
-- sale AND a phantom return in every report. This adds the two operations that
-- were actually missing, plus the attribution field Sales never had:
--
--   edit_sale()  corrects a sale in place. Invoice number KEPT, stock
--                reconciled to the corrected lines, payment re-derived.
--   void_sale()  marks a sale as never having happened. Stock fully restored,
--                the row KEPT with its invoice number and a Voided stamp, and
--                excluded from every revenue figure.
--   sold_by_id   who made the sale, mirroring service_jobs.assigned_mechanic_id.
--
-- Design note — why void is a stamp, not a delete. TW-S- is a numbered,
-- GST-facing invoice series. Deleting the row would leave an unexplained gap
-- that nobody can later account for; stamping it leaves a number an auditor can
-- see was voided, by whom, and why. The cost is that every revenue read path
-- has to filter `voided_at is null` — six of them, each changed and tested
-- individually rather than trusted to a convention.
--
-- Design note — the record_sale() refactor. record_sale()'s ~250-line body has
-- been re-emitted verbatim three times already (0022, 0024, 0026), which
-- doc/payment-split-scope.md flagged as the single easiest source of silent
-- drift in this codebase. edit_sale() needs the exact same line-building and
-- stock logic, so rather than create a FOURTH copy this migration extracts that
-- logic once into replace_sale_lines() and re-emits record_sale() one final
-- time as a thin caller. After this there is one copy, not two — this
-- re-emission is what ends the duplication rather than extending it.
--
-- Design note — which price an edited line uses. A line whose item was already
-- on the invoice keeps the price the customer was actually charged; only a
-- newly added or swapped item takes the current master price. Without this, a
-- typo fixed in August on a June bill would silently restate that bill at
-- August prices, and June's revenue figure would move retroactively. The old
-- price is read from the sale's own rows, never from the client — so this is
-- not a back door for typing arbitrary prices into a bill.
--
-- Idempotency note (see prior migration headers): safely re-runnable.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

alter table public.sales
  add column if not exists sold_by_id uuid references public.profiles (id),
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references auth.users (id),
  add column if not exists void_reason text;

create index if not exists sales_sold_by_idx on public.sales (sold_by_id) where sold_by_id is not null;
-- Every revenue read path filters on this, and live sales vastly outnumber
-- voided ones, so the partial index is the one that matters.
create index if not exists sales_live_idx on public.sales (sale_date desc) where voided_at is null;

-- Backfill attribution from created_by, but only where that id is a real
-- profile. A sale recorded by an account that has since been deleted stays
-- Unassigned rather than being attributed to nobody-in-particular — the same
-- "don't invent data you don't have" rule 0027 followed for payment tender.
update public.sales s
   set sold_by_id = s.created_by
  where s.sold_by_id is null
    and s.created_by is not null
    and exists (select 1 from public.profiles p where p.id = s.created_by);

-- ---------------------------------------------------------------------------
-- 2. Audit trail.
--
--    Sales Person can now edit and void, not just record. Voiding removes both
--    the stock movement and the cash from every report, so it is the one
--    action whose misuse is invisible in the totals — there has to be a
--    record of who did it and why. Mirrors service_job_events.
-- ---------------------------------------------------------------------------

create table if not exists public.sale_events (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales (id) on delete restrict,
  event_type text not null check (event_type in ('SALE_EDITED', 'SALE_VOIDED')),
  detail text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index if not exists sale_events_sale_idx on public.sale_events (sale_id, created_at);

alter table public.sale_events enable row level security;

drop policy if exists "sale_events_read" on public.sale_events;
create policy "sale_events_read" on public.sale_events
  for select using (public.has_sales_access());

-- ---------------------------------------------------------------------------
-- 3. Staff roster visibility.
--
--    profiles_select_staff (0026) granted the roster to has_service_access() —
--    Admin and Mechanic. A Sales Person cannot read profiles at all today,
--    which would leave the new "Sold by" picker empty and the list's Sold-by
--    column blank for exactly the people who need it. profiles holds only id,
--    name, role and active flag, so widening it to any staff member exposes
--    nothing sensitive. Still reads the JWT, not profiles, so it can't recurse.
-- ---------------------------------------------------------------------------

drop policy if exists "profiles_select_staff" on public.profiles;
create policy "profiles_select_staff" on public.profiles
  for select using (public.has_service_access() or public.has_sales_access());

-- ---------------------------------------------------------------------------
-- 3b. can_correct_sales() — who may rewrite or erase a recorded sale.
--
--     NOT has_sales_access(), deliberately. That helper includes Mechanic
--     (0026 gave them sales access so they can sell parts at the counter), but
--     correcting and voiding were scoped to Administrator and Sales Person.
--     Voiding removes both the stock movement and the cash from every revenue
--     figure, so it is the one action whose misuse is invisible in the totals —
--     widening it is a decision to take deliberately, by changing this one
--     function, not by inheriting a helper that happened to be broader.
-- ---------------------------------------------------------------------------

create or replace function public.can_correct_sales()
returns boolean
language sql
stable
set search_path = public
as $$
  select public.jwt_role() in ('admin', 'sales_person');
$$;

grant execute on function public.can_correct_sales() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. replace_sale_lines() — the extracted line-building core.
--
--    Deletes and reinserts every sale_items row for a sale, deducting stock as
--    it goes, then recomputes the sale's three totals from what it actually
--    wrote. Called by record_sale() (empty starting state) and edit_sale()
--    (full replace). Body is record_sale()'s former loop, moved not rewritten.
--
--    p_keep_existing_prices: edit path only. Before deleting, snapshots the
--    unit_selling_price already recorded per inventory item on this sale; any
--    line whose item was already on the invoice reuses that price instead of
--    reading the master. Combo components are excluded from the snapshot —
--    their price is dictated by the combo definition, not the invoice.
--
--    Not granted to authenticated: it performs no authorization of its own,
--    because both callers have already established the caller may write sales.
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
  v_gst_amount numeric;
  v_discount_amount numeric;
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'A sale requires at least one line item' using errcode = '22023';
  end if;

  if coalesce(p_keep_existing_prices, false) then
    select coalesce(jsonb_object_agg(s.inventory_item_id::text, s.unit_selling_price), '{}'::jsonb)
      into v_price_snapshot
      from (
        select distinct on (inventory_item_id) inventory_item_id, unit_selling_price
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

      v_unit_price := (v_price_snapshot ->> v_item_id::text)::numeric;

      if v_unit_price is null then
        -- New or swapped item: today's master price, active items only.
        select selling_price into v_unit_price
          from public.inventory_items
          where id = v_item_id and is_active;

        if v_unit_price is null then
          raise exception 'Inventory item % not found or inactive', v_item_id using errcode = 'P0002';
        end if;
      else
        -- Already on this invoice: keep what the customer was charged. An item
        -- deactivated since the sale is still allowed here — it was legitimately
        -- sold at the time, and refusing would make the bill uncorrectable.
        if not exists (select 1 from public.inventory_items where id = v_item_id) then
          raise exception 'Inventory item % not found', v_item_id using errcode = 'P0002';
        end if;
      end if;

      insert into public.sale_items
        (sale_id, position, line_type, inventory_item_id, quantity, unit_selling_price)
      values
        (p_sale_id, v_position, 'PRODUCT', v_item_id, v_quantity, v_unit_price);

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

revoke execute on function public.replace_sale_lines(uuid, jsonb, boolean) from public;

-- ---------------------------------------------------------------------------
-- 5. record_sale() — re-emitted ONE last time, now a thin caller.
--
--    Every guard, message and error code below is carried over unchanged from
--    the 0026 version. The only difference is that the 200-line line-building
--    loop is gone, replaced by the replace_sale_lines() call, and a trailing
--    p_sold_by_id parameter. Behaviour for an ordinary sale is identical —
--    asserted by replaying this migration set and recording a sale before and
--    after.
--
--    Signature changed (new trailing parameter), so the old one is dropped
--    first — same as 0026 did for create_service_job().
-- ---------------------------------------------------------------------------

drop function if exists public.record_sale(
  text, text, text, boolean, numeric, boolean, numeric, jsonb, text
);

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

grant execute on function public.record_sale(
  text, text, text, boolean, numeric, boolean, numeric, jsonb, text, uuid
) to authenticated;

-- record_sale_with_payment() (0027) gains the same trailing parameter and
-- passes it straight through. Its own body is otherwise untouched.
drop function if exists public.record_sale_with_payment(
  text, text, text, boolean, numeric, boolean, numeric, jsonb, text, numeric, numeric
);

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

grant execute on function public.record_sale_with_payment(
  text, text, text, boolean, numeric, boolean, numeric, jsonb, text, numeric, numeric, uuid
) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. restore_sale_stock() — internal. Puts back everything a sale deducted.
--
--    PRODUCT lines only: INSTALLATION and COMBO header lines never moved stock,
--    and combo COMPONENT lines are PRODUCT rows, so they're covered here.
-- ---------------------------------------------------------------------------

create or replace function public.restore_sale_stock(
  p_sale_id uuid,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
begin
  for v_item in
    select inventory_item_id, quantity
      from public.sale_items
      where sale_id = p_sale_id
        and line_type = 'PRODUCT'
        and inventory_item_id is not null
        and coalesce(quantity, 0) > 0
      for update
  loop
    perform public.adjust_stock(v_item.inventory_item_id, v_item.quantity, 'SALE', 'sales', p_note);
  end loop;
end;
$$;

revoke execute on function public.restore_sale_stock(uuid, text) from public;

-- Shared guard: a sale with a return recorded against it cannot have its lines
-- replaced or its stock reversed, because sale_returns.sale_item_id is
-- `on delete restrict` and the return already moved that stock once. Raising
-- here turns an opaque foreign-key error into an instruction.
create or replace function public.assert_sale_correctable(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice text;
  v_returns integer;
begin
  select invoice_number into v_invoice from public.sales where id = p_sale_id;

  select count(*) into v_returns
    from public.sale_returns r
    join public.sale_items i on i.id = r.sale_item_id
   where i.sale_id = p_sale_id;

  if v_returns > 0 then
    raise exception 'Invoice % has a return recorded against it — undo the return first, then try again',
      coalesce(v_invoice, '(unknown)') using errcode = '22023';
  end if;
end;
$$;

revoke execute on function public.assert_sale_correctable(uuid) from public;

-- ---------------------------------------------------------------------------
-- 7. void_sale() — the sale never happened.
-- ---------------------------------------------------------------------------

create or replace function public.void_sale(
  p_sale_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice text;
  v_voided timestamptz;
  v_total numeric;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.can_correct_sales() then
    raise exception 'Not authorized to void sales' using errcode = '42501';
  end if;
  if v_reason = '' then
    raise exception 'A reason is required to void a sale' using errcode = '22023';
  end if;

  select invoice_number, voided_at, grand_total into v_invoice, v_voided, v_total
    from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'Sale % not found', p_sale_id using errcode = 'P0002';
  end if;
  if v_voided is not null then
    raise exception 'Invoice % is already voided', v_invoice using errcode = '22023';
  end if;

  perform public.assert_sale_correctable(p_sale_id);
  perform public.restore_sale_stock(p_sale_id, 'Void of invoice ' || coalesce(v_invoice, '') || ' — ' || v_reason);

  -- The row and its lines stay. Only the money and the stock are undone, plus
  -- the stamp that keeps it out of every revenue figure.
  update public.sales
    set voided_at = now(),
        voided_by = auth.uid(),
        void_reason = v_reason,
        payment_mode = null,
        cash_amount = 0,
        upi_amount = 0,
        payment_status = 'PENDING'
    where id = p_sale_id;

  insert into public.sale_events (sale_id, event_type, detail, created_by)
  values (
    p_sale_id,
    'SALE_VOIDED',
    'Invoice ' || coalesce(v_invoice, '(none)') || ' voided, '
      || to_char(coalesce(v_total, 0), 'FM999999990.00') || ' removed from revenue — ' || v_reason,
    auth.uid()
  );
end;
$$;

grant execute on function public.void_sale(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. edit_sale() — corrects a recorded sale in place, invoice number kept.
-- ---------------------------------------------------------------------------

create or replace function public.edit_sale(
  p_sale_id uuid,
  p_customer_name text,
  p_customer_mobile text,
  p_customer_address text,
  p_gst_applicable boolean,
  p_gst_amount numeric,
  p_discount_applicable boolean,
  p_discount_amount numeric,
  p_lines jsonb,
  p_sold_by_id uuid default null,
  p_payment_mode text default null,
  p_cash_amount numeric default 0,
  p_upi_amount numeric default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice text;
  v_voided timestamptz;
  v_customer_id uuid;
  v_old_total numeric;
  v_new_total numeric;
  v_gst_amount numeric := coalesce(p_gst_amount, 0);
  v_discount_amount numeric := coalesce(p_discount_amount, 0);
  v_cash numeric := round(coalesce(p_cash_amount, 0), 2);
  v_upi numeric := round(coalesce(p_upi_amount, 0), 2);
  v_mode text;
  v_status text;
begin
  if not public.can_correct_sales() then
    raise exception 'Not authorized to edit sales' using errcode = '42501';
  end if;
  if p_customer_mobile is null or btrim(p_customer_mobile) = '' then
    raise exception 'Customer mobile number is required' using errcode = '22023';
  end if;
  if p_customer_name is null or btrim(p_customer_name) = '' then
    raise exception 'Customer name is required' using errcode = '22023';
  end if;
  if v_gst_amount < 0 then
    raise exception 'GST amount cannot be negative' using errcode = '22023';
  end if;
  if v_discount_amount < 0 then
    raise exception 'Discount amount cannot be negative' using errcode = '22023';
  end if;
  if p_payment_mode is not null and p_payment_mode not in ('CASH', 'UPI', 'SPLIT') then
    raise exception 'Unknown payment mode %', p_payment_mode using errcode = '22023';
  end if;
  if v_cash < 0 or v_upi < 0 then
    raise exception 'Payment amounts cannot be negative' using errcode = '22023';
  end if;
  if p_sold_by_id is not null and not exists (
    select 1 from public.profiles p where p.id = p_sold_by_id and p.is_active
  ) then
    raise exception 'Sold by must be an active staff member' using errcode = '22023';
  end if;

  select invoice_number, voided_at, grand_total into v_invoice, v_voided, v_old_total
    from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'Sale % not found', p_sale_id using errcode = 'P0002';
  end if;
  if v_voided is not null then
    raise exception 'Invoice % is voided and can no longer be edited', v_invoice using errcode = '22023';
  end if;

  perform public.assert_sale_correctable(p_sale_id);

  -- Step 1: pull back everything this sale deducted, before replace_sale_lines()
  -- deletes the rows that say what those quantities were.
  perform public.restore_sale_stock(p_sale_id, 'Correction to invoice ' || coalesce(v_invoice, ''));

  select id into v_customer_id from public.customers where mobile_number = btrim(p_customer_mobile);
  if v_customer_id is null then
    insert into public.customers (name, mobile_number, address)
    values (btrim(p_customer_name), btrim(p_customer_mobile), nullif(btrim(p_customer_address), ''))
    returning id into v_customer_id;
  end if;

  -- GST/discount must land before replace_sale_lines(), which reads them back
  -- off the row to compute grand_total.
  update public.sales
    set customer_id = v_customer_id,
        gst_applicable = coalesce(p_gst_applicable, false),
        gst_amount = v_gst_amount,
        discount_applicable = coalesce(p_discount_applicable, false),
        discount_amount = v_discount_amount,
        sold_by_id = p_sold_by_id
    where id = p_sale_id;

  -- Step 2: rebuild the lines and re-deduct. `true` keeps the price already on
  -- the invoice for any item that was already on it. An insufficient-stock
  -- raise in here aborts the whole function, restore included.
  perform public.replace_sale_lines(p_sale_id, p_lines, true);

  select grand_total into v_new_total from public.sales where id = p_sale_id;

  -- Step 3: re-derive payment against the corrected total.
  if p_payment_mode = 'CASH' then
    v_upi := 0;
  elsif p_payment_mode = 'UPI' then
    v_cash := 0;
  elsif p_payment_mode is null then
    v_cash := 0;
    v_upi := 0;
  end if;

  if round(v_cash + v_upi, 2) > round(coalesce(v_new_total, 0), 2) then
    raise exception 'Recorded payment (%) is more than the corrected total (%) — reduce the payment on this sale first',
      round(v_cash + v_upi, 2), round(coalesce(v_new_total, 0), 2) using errcode = '22023';
  end if;

  v_mode := public.derive_payment_mode(v_cash, v_upi);
  v_status := public.derive_payment_status(v_cash, v_upi, v_new_total);

  update public.sales
    set payment_mode = v_mode,
        cash_amount = v_cash,
        upi_amount = v_upi,
        payment_status = v_status
    where id = p_sale_id;

  insert into public.sale_events (sale_id, event_type, detail, created_by)
  values (
    p_sale_id,
    'SALE_EDITED',
    'Invoice ' || coalesce(v_invoice, '(none)') || ' corrected — total '
      || to_char(coalesce(v_old_total, 0), 'FM999999990.00') || ' to '
      || to_char(coalesce(v_new_total, 0), 'FM999999990.00'),
    auth.uid()
  );
end;
$$;

grant execute on function public.edit_sale(
  uuid, text, text, text, boolean, numeric, boolean, numeric, jsonb, uuid, text, numeric, numeric
) to authenticated;
