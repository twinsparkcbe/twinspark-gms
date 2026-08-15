-- Online Orders — pricing. Adds a snapshot unit price per position and a
-- computed total to online_orders, and a public read-only price lookup so
-- the order form can show "how much am I about to pay" before submitting.
--
-- Prices are NEVER trusted from the client: submit_online_order() looks up
-- the current selling_price for the active "Track Tyre - Front"/"Track Tyre
-- - Back" inventory items itself (same lookup dispatch_online_order already
-- does — 0018_online_orders_schema.sql) and stores that snapshot, exactly
-- the way record_sale()/record_purchase_entry() compute totals server-side
-- rather than accepting a client-supplied amount. A price shown on the
-- public form at page-load time and the price actually stored at submit
-- time can theoretically differ if the price changes in between — same as
-- any storefront where the checkout price is re-confirmed at payment time.

-- ---------------------------------------------------------------------------
-- 1. New columns
-- ---------------------------------------------------------------------------

alter table public.online_orders
  add column unit_price_front numeric(12, 2),
  add column unit_price_back numeric(12, 2),
  add column total_amount numeric(14, 2) not null default 0;

-- ---------------------------------------------------------------------------
-- 2. submit_online_order() — re-declared (same signature, CREATE OR
--    REPLACE) to snapshot prices and compute the total at insert time.
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
  v_price_front numeric;
  v_price_back numeric;
  v_total numeric;
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

  -- Snapshot current prices server-side — never trust a client-supplied
  -- amount for money. Missing item (e.g. that position was never stocked
  -- yet) just prices that line at 0 rather than blocking submission —
  -- Dispatch, not Submit, is where stock/price actually has to be real.
  if v_qty_front > 0 then
    select selling_price into v_price_front
      from public.inventory_items
      where item_type = 'TRACK_TYRE' and product_name = 'Track Tyre - Front' and is_active = true
      order by created_at desc
      limit 1;
  end if;
  if v_qty_back > 0 then
    select selling_price into v_price_back
      from public.inventory_items
      where item_type = 'TRACK_TYRE' and product_name = 'Track Tyre - Back' and is_active = true
      order by created_at desc
      limit 1;
  end if;

  v_total := (v_qty_front * coalesce(v_price_front, 0)) + (v_qty_back * coalesce(v_price_back, 0));

  insert into public.online_orders
    (customer_name, mobile_number, address, pin_code, quantity_front, quantity_back,
     payment_screenshot_path, unit_price_front, unit_price_back, total_amount)
  values
    (btrim(p_customer_name), btrim(p_mobile_number), btrim(p_address), p_pin_code, v_qty_front, v_qty_back,
     p_payment_screenshot_path, v_price_front, v_price_back, v_total)
  returning id into v_order_id;

  return v_order_id;
end;
$$;

grant execute on function public.submit_online_order(text, text, text, text, integer, integer, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. get_track_tyre_prices() — public, read-only price lookup for the order
--    form. Deliberately narrow: only exposes product_name + selling_price
--    for the two Track Tyre positions, nothing else from inventory_items
--    (which itself has no anon read policy — see 0001_inventory_schema.sql).
--    Returns 0-2 rows depending on which positions currently have an active
--    item; a position with no active item just doesn't appear.
-- ---------------------------------------------------------------------------

create or replace function public.get_track_tyre_prices()
returns table (product_name text, selling_price numeric)
language sql
security definer
set search_path = public
stable
as $$
  select product_name, selling_price
  from public.inventory_items
  where item_type = 'TRACK_TYRE'
    and product_name in ('Track Tyre - Front', 'Track Tyre - Back')
    and is_active = true;
$$;

grant execute on function public.get_track_tyre_prices() to anon, authenticated;
