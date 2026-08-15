-- Online Orders (Online Track Tyre Orders) — spec §3.16/§3.17/§4.11,
-- doc/online-orders-scope.md. Public, unauthenticated order submission
-- (Front/Back Track Tyre quantities + a payment screenshot) queued through
-- a one-directional Admin/Sales Person workflow: SUBMITTED ->
-- PAYMENT_VERIFIED -> APPROVED -> DISPATCHED, with REJECTED reachable from
-- either of the first two states. Stock only moves at Dispatch, via the
-- existing adjust_stock() (ONLINE_ORDER_DISPATCH was already a valid
-- stock_movement_reason as of 0001_inventory_schema.sql, already authorized
-- for admin+sales_person as of 0013_sales_schema.sql — no changes needed
-- there).
--
-- This is the app's first genuinely public, unauthenticated write surface —
-- see §1 below for why the table has no direct insert/update policy at all,
-- only SECURITY DEFINER RPCs, same immutable-audit-trail pattern already
-- used for purchase_entries/sales/service_jobs.

-- ---------------------------------------------------------------------------
-- 1. Enum + table
-- ---------------------------------------------------------------------------

create type public.online_order_status as enum (
  'SUBMITTED',
  'PAYMENT_VERIFIED',
  'APPROVED',
  'DISPATCHED',
  'REJECTED'
);

create table public.online_orders (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  mobile_number text not null,
  address text not null,
  pin_code text not null,
  -- doc/online-orders-scope.md §0: the spec's single "quantity" field is
  -- ambiguous now that Track Tyre Front/Back are separate inventory rows
  -- (doc/track-tyre-front-back-split-scope.md). Two explicit quantities
  -- replace it; the check below requires at least one to be positive.
  quantity_front integer not null default 0,
  quantity_back integer not null default 0,
  -- Storage path (not a public URL) in the private online-order-screenshots
  -- bucket — §4: screenshots aren't public, so staff view them via a signed
  -- URL generated on demand, never a guessable public link.
  payment_screenshot_path text not null,
  status public.online_order_status not null default 'SUBMITTED',
  rejection_reason text,
  submitted_at timestamptz not null default now(),
  verified_by uuid references auth.users (id),
  verified_at timestamptz,
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  dispatched_by uuid references auth.users (id),
  dispatched_at timestamptz,
  rejected_by uuid references auth.users (id),
  rejected_at timestamptz,
  created_at timestamptz not null default now(),
  constraint online_orders_quantity_nonnegative check (quantity_front >= 0 and quantity_back >= 0),
  constraint online_orders_quantity_at_least_one check (quantity_front > 0 or quantity_back > 0),
  constraint online_orders_pin_code_format check (pin_code ~ '^[0-9]{6}$')
);

create index online_orders_status_idx on public.online_orders (status, submitted_at desc);
create index online_orders_mobile_idx on public.online_orders (mobile_number);
create index online_orders_submitted_at_idx on public.online_orders (submitted_at desc);

-- ---------------------------------------------------------------------------
-- 2. submit_online_order() — the only way a new order gets created. Public:
--    no role check at all, callable by `anon`. Deliberately narrow (just the
--    order fields) so an anonymous caller can never set status/verified_by/
--    etc. directly — those only ever change via the staff-only functions
--    below.
-- ---------------------------------------------------------------------------

create or replace function public.submit_online_order(
  p_customer_name text,
  p_mobile_number text,
  p_address text,
  p_pin_code text,
  p_quantity_front integer,
  p_quantity_back integer,
  p_payment_screenshot_path text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_qty_front integer := coalesce(p_quantity_front, 0);
  v_qty_back integer := coalesce(p_quantity_back, 0);
begin
  if p_customer_name is null or btrim(p_customer_name) = '' then
    raise exception 'Customer name is required' using errcode = '22023';
  end if;
  if p_mobile_number is null or btrim(p_mobile_number) = '' then
    raise exception 'Mobile number is required' using errcode = '22023';
  end if;
  if p_address is null or btrim(p_address) = '' then
    raise exception 'Address is required' using errcode = '22023';
  end if;
  if p_pin_code is null or p_pin_code !~ '^[0-9]{6}$' then
    raise exception 'PIN code must be exactly 6 digits' using errcode = '22023';
  end if;
  if v_qty_front < 0 or v_qty_back < 0 then
    raise exception 'Quantity cannot be negative' using errcode = '22023';
  end if;
  if v_qty_front = 0 and v_qty_back = 0 then
    raise exception 'Order at least one Track Tyre (Front or Back)' using errcode = '22023';
  end if;
  if p_payment_screenshot_path is null or btrim(p_payment_screenshot_path) = '' then
    raise exception 'A payment screenshot is required' using errcode = '22023';
  end if;

  insert into public.online_orders
    (customer_name, mobile_number, address, pin_code, quantity_front, quantity_back, payment_screenshot_path)
  values
    (btrim(p_customer_name), btrim(p_mobile_number), btrim(p_address), p_pin_code, v_qty_front, v_qty_back, p_payment_screenshot_path)
  returning id into v_order_id;

  return v_order_id;
end;
$$;

grant execute on function public.submit_online_order(text, text, text, text, integer, integer, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Staff workflow functions — admin OR sales_person for every action
--    (doc/online-orders-scope.md §5: confirmed default is Sales Person gets
--    Approve too, not just Verify/Dispatch). Each enforces the one-directional
--    state machine by requiring the exact current status in its UPDATE's
--    WHERE clause; a mismatch (wrong status, or the order doesn't exist)
--    raises P0002 so the caller can show a clear "already handled elsewhere /
--    not found" message instead of silently no-op'ing.
-- ---------------------------------------------------------------------------

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
  if v_role is distinct from 'admin' and v_role is distinct from 'sales_person' then
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

grant execute on function public.verify_online_order_payment(uuid) to authenticated;

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
  if v_role is distinct from 'admin' and v_role is distinct from 'sales_person' then
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

grant execute on function public.approve_online_order(uuid) to authenticated;

-- Dispatch is the only point stock moves (spec §3.16/§4.11, non-negotiable).
-- Looks up the Front/Back Track Tyre item ids by their fixed derived names
-- (doc/track-tyre-front-back-split-scope.md — "Track Tyre - Front" /
-- "Track Tyre - Back", same convention as getActiveTrackTyreItem() in
-- services/inventory/items.ts) and decrements each non-zero line through the
-- existing adjust_stock() — same FIFO/insufficient-stock guard every other
-- module already relies on, so a stock shortfall blocks Dispatch atomically
-- (both decrements roll back together if either fails, since this all runs
-- in one transaction).
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
  if v_role is distinct from 'admin' and v_role is distinct from 'sales_person' then
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

grant execute on function public.dispatch_online_order(uuid) to authenticated;

-- Reachable from SUBMITTED or PAYMENT_VERIFIED only (terminal, no stock
-- impact — Dispatch never ran). A reason is required, same convention as
-- every other stock/state-correcting action in this system.
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
  if v_role is distinct from 'admin' and v_role is distinct from 'sales_person' then
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

grant execute on function public.reject_online_order(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Row Level Security — table itself has no insert/update/delete policy at
--    all (mirrors customers/sales in 0013_sales_schema.sql): every write
--    goes through a SECURITY DEFINER function above. Only a read policy for
--    logged-in Admin/Sales Person; the public submission page never reads
--    this table directly (submit_online_order returns the new id, that's
--    all the confirmation screen needs).
-- ---------------------------------------------------------------------------

alter table public.online_orders enable row level security;

create policy "online_orders_staff_read" on public.online_orders
  for select using (
    (auth.jwt() -> 'user_metadata' ->> 'role') in ('admin', 'sales_person')
  );

-- ---------------------------------------------------------------------------
-- 5. Storage — payment screenshots. Private bucket (public = false):
--    unlike inventory/service photos, these can carry UPI transaction
--    details and should never be reachable via a guessable public URL.
--    `anon` can INSERT (the whole point of the public order form) but only
--    Admin/Sales Person can SELECT (to generate a signed URL for viewing);
--    no update/delete — screenshots are immutable once uploaded, same
--    audit-trail stance as every other write path in this system.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'online-order-screenshots',
  'online-order-screenshots',
  false,
  5242880, -- 5 MB
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

create policy "online_order_screenshots_anon_insert" on storage.objects
  for insert to anon
  with check (bucket_id = 'online-order-screenshots');

create policy "online_order_screenshots_authenticated_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'online-order-screenshots');

create policy "online_order_screenshots_staff_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'online-order-screenshots'
    and (auth.jwt() -> 'user_metadata' ->> 'role') in ('admin', 'sales_person')
  );
