-- Online Orders — invoice number, assigned at dispatch.
--
-- Until now a dispatched online order had no document the customer could be
-- given. This adds one, on its own numbering series (TW-O-000001) rather
-- than sharing the counter series (TW-S-) — the two channels are kept
-- separate on purpose (doc/online-orders-revenue-scope.md §2), so a shop
-- bill and an online invoice can never collide or interleave.
--
-- The number is assigned once, inside dispatch_online_order(), and never
-- changes afterwards. Only a DISPATCHED order has one: an order that is
-- rejected, or still waiting, is not a completed sale and gets no invoice.

-- ---------------------------------------------------------------------------
-- 1. Sequence + formatter
-- ---------------------------------------------------------------------------

create sequence if not exists public.online_order_invoice_number_seq;

-- lpad() TRUNCATES rather than overflows — lpad('1234567', 6, '0') is
-- '123456', which would silently collide with invoice 123456. The case
-- guard lets the number simply grow past six digits instead. (The same trap
-- is live in next_sales_invoice_number()/next_service_invoice_number(); not
-- touched here, but worth knowing before either series gets that far.)
create or replace function public.next_online_invoice_number()
returns text
language plpgsql
volatile
as $$
declare
  v bigint := nextval('public.online_order_invoice_number_seq');
begin
  return 'TW-O-' || case when v < 1000000 then lpad(v::text, 6, '0') else v::text end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Column
-- ---------------------------------------------------------------------------

alter table public.online_orders
  add column invoice_number text;

-- Unique only where present: every not-yet-dispatched order has NULL here,
-- and NULLs do not conflict under a unique index.
create unique index online_orders_invoice_number_key
  on public.online_orders (invoice_number)
  where invoice_number is not null;

comment on column public.online_orders.invoice_number is
  'TW-O-000001 series, assigned once at dispatch. Null until then; never reused.';

-- ---------------------------------------------------------------------------
-- 3. dispatch_online_order() — same signature, so CREATE OR REPLACE genuinely
--    replaces rather than adding an overload. Identical to the 0018 version
--    apart from the invoice number assignment in the final UPDATE.
-- ---------------------------------------------------------------------------

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

  select id, quantity_front, quantity_back, invoice_number into v_order
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

  -- coalesce, not a bare assignment: an order can only reach here from
  -- APPROVED so in practice invoice_number is always null, but if that ever
  -- stops being true the original number must survive rather than the
  -- customer's copy silently disagreeing with the shop's record.
  update public.online_orders
    set status = 'DISPATCHED',
        dispatched_by = auth.uid(),
        dispatched_at = now(),
        invoice_number = coalesce(v_order.invoice_number, public.next_online_invoice_number())
    where id = p_order_id;
end;
$$;

grant execute on function public.dispatch_online_order(uuid) to authenticated;
grant execute on function public.next_online_invoice_number() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Backfill: orders dispatched before this migration have no invoice
--    number. Numbered oldest-first so the series runs in dispatch order
--    rather than in whatever order Postgres happens to return rows.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select id from public.online_orders
     where status = 'DISPATCHED' and invoice_number is null
     order by dispatched_at nulls last, created_at
  loop
    update public.online_orders
       set invoice_number = public.next_online_invoice_number()
     where id = r.id;
  end loop;
end $$;

notify pgrst, 'reload schema';
