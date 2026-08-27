-- Online Orders — customer-quoted amount override.
--
-- Background: 0019_online_orders_pricing.sql deliberately computed the order
-- total server-side and never trusted a client-supplied figure. That rule
-- still stands for the *catalogue* price. What changes here is that the shop
-- quotes prices over the phone/WhatsApp before the customer ever opens
-- /order (confirmed 2026-08-27) — courier included, a walk-in discount, a
-- bulk rate — so the number the customer must actually pay is frequently not
-- the catalogue number, and a hard-computed total left them guessing.
--
-- The fix is to store BOTH figures rather than to stop computing one, the
-- same shape 0034_sale_line_price_override.sql established for Sales
-- (list_price alongside unit_selling_price):
--
--   computed_amount      what the catalogue says this order is worth.
--                        Always calculated here, never writable by the
--                        client. This is the reference figure.
--   total_amount         what the customer will actually pay. Defaults to
--                        computed_amount; the customer may override it with
--                        the amount they were quoted.
--   amount_is_overridden generated — true whenever the two differ. A stored
--                        generated column rather than a flag the insert path
--                        has to remember to set, so it can never fall out of
--                        sync (same reasoning as stock_status in
--                        0001_inventory_schema.sql).
--
-- /order is the app's only anonymous write path, so an unbounded client
-- amount would be a real hole: an anonymous visitor could book two tyres at
-- ₹1 and the Online Orders revenue stat would follow them. Two things close
-- it. First, bounds enforced below — a quoted amount must be positive and
-- cannot exceed three times the catalogue value (floor ₹1,00,000, which
-- covers the case where neither position has an active priced item yet).
-- Second, amount_is_overridden puts every deviation in front of a staff
-- member at Verify Payment, where the screenshot is checked anyway. Staff
-- are warned, not blocked — a quoted discount is the normal case, not the
-- exception, and gating it behind an extra approval would tax the common
-- path to catch the rare one.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

alter table public.online_orders
  add column computed_amount numeric(14, 2) not null default 0;

-- Existing rows predate the override entirely: their total_amount *is* the
-- catalogue figure, so the two columns agree and amount_is_overridden comes
-- out false for all history. Runs before the generated column is added so
-- there is no window where old rows look overridden.
update public.online_orders set computed_amount = total_amount;

alter table public.online_orders
  add column amount_is_overridden boolean
    generated always as (total_amount is distinct from computed_amount) stored;

comment on column public.online_orders.computed_amount is
  'Catalogue value of this order, computed server-side at submission. Never client-writable.';
comment on column public.online_orders.total_amount is
  'Amount the customer will actually pay — the quoted override when given, otherwise computed_amount.';

-- ---------------------------------------------------------------------------
-- 2. submit_online_order() — now takes an optional quoted amount.
--
--    IMPORTANT: this is a DROP + CREATE, not a CREATE OR REPLACE. Postgres
--    only replaces a function whose signature matches exactly; adding
--    p_quoted_amount would otherwise leave the 7-argument version in place
--    as a second overload, and PostgREST would then have two candidates to
--    choose between. That exact failure mode is what
--    0035_repair_sale_function_overloads.sql had to clean up for
--    record_sale() — not repeating it here.
-- ---------------------------------------------------------------------------

drop function if exists public.submit_online_order(text, text, text, text, integer, integer, text);

create or replace function public.submit_online_order(
  p_customer_name text,
  p_mobile_number text,
  p_address text,
  p_pin_code text,
  p_quantity_front integer,
  p_quantity_back integer,
  p_payment_screenshot_path text,
  p_quoted_amount numeric default null
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
  v_computed numeric;
  v_quoted numeric;
  v_max numeric;
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

  -- Snapshot current catalogue prices server-side. A missing item (that
  -- position was never stocked yet) prices that line at 0 rather than
  -- blocking submission — Dispatch, not Submit, is where stock/price
  -- actually has to be real.
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

  v_computed := (v_qty_front * coalesce(v_price_front, 0)) + (v_qty_back * coalesce(v_price_back, 0));

  if p_quoted_amount is null then
    v_total := v_computed;
  else
    v_quoted := round(p_quoted_amount, 2);

    if v_quoted <= 0 then
      raise exception 'Amount must be greater than zero' using errcode = '22023';
    end if;

    -- Ceiling for a public, unauthenticated write. Three times the
    -- catalogue value leaves ample room for courier charges or a
    -- quantity-based quote while still refusing an absurd figure. The flat
    -- ₹1,00,000 applies only when v_computed is 0 — neither position has an
    -- active priced item, so there is no multiple to take — and is
    -- deliberately NOT a floor under the 3x rule, which would swallow it
    -- entirely for every realistically-sized order.
    --
    -- Note there is no *lower* bound beyond "greater than zero", on
    -- purpose. A too-low amount is caught by a human at Verify Payment,
    -- where the screenshot is checked against the figure anyway, and a
    -- percentage floor here would block legitimate part-payment or advance
    -- arrangements the shop may want to quote.
    if v_computed > 0 then
      v_max := v_computed * 3;
    else
      v_max := 100000;
    end if;

    if v_quoted > v_max then
      raise exception 'That amount does not look right for this order — please call us to confirm the price'
        using errcode = '22023';
    end if;

    v_total := v_quoted;
  end if;

  insert into public.online_orders
    (customer_name, mobile_number, address, pin_code, quantity_front, quantity_back,
     payment_screenshot_path, unit_price_front, unit_price_back, computed_amount, total_amount)
  values
    (btrim(p_customer_name), btrim(p_mobile_number), btrim(p_address), p_pin_code, v_qty_front, v_qty_back,
     p_payment_screenshot_path, v_price_front, v_price_back, v_computed, v_total)
  returning id into v_order_id;

  return v_order_id;
end;
$$;

grant execute on function public.submit_online_order(text, text, text, text, integer, integer, text, numeric)
  to anon, authenticated;

-- PostgREST caches the schema; without this the new argument is rejected as
-- unknown until the connection pool happens to refresh.
notify pgrst, 'reload schema';
