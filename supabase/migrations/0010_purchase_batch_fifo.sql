-- FIFO Batch Tracking.
-- See doc/purchase-batch-fifo-scope.md for the confirmed feature/use-case
-- list this schema implements.
--
-- Every purchase_entries row becomes a "batch" with its own remaining
-- quantity, consumed oldest-purchase-date-first by any stock decrease.
-- inventory_items.available_quantity stays as a fast-read cached total —
-- adjust_stock() below is rewritten to keep it in lockstep with the
-- batches' remaining_quantity totals inside the same transaction, so it's
-- never a separate source of truth that can drift.

-- ---------------------------------------------------------------------------
-- Columns
--
-- Every ADD COLUMN / ADD CONSTRAINT below is guarded (IF NOT EXISTS, or a
-- pg_constraint existence check) so this whole file is safe to run more
-- than once. That's not theoretical: Supabase's SQL editor does NOT wrap a
-- pasted multi-statement script in one all-or-nothing transaction — each
-- statement commits as it runs, so a script that fails partway through (as
-- this one did, on the pre-fix "adjust_stock is not unique" error) leaves
-- everything before the failure point permanently applied. Re-running the
-- old unguarded version of this file then failed again immediately with
-- "column batch_number already exists". These guards make it converge
-- correctly regardless of how far a previous attempt got.
-- ---------------------------------------------------------------------------

alter table public.purchase_entries
  add column if not exists batch_number text,
  add column if not exists remaining_quantity integer,
  -- Optional per-batch selling price. Null means "use the item's selling_
  -- price" (set in Inventory) — most purchases don't need this; it exists
  -- for the rare case of a discounted bulk buy the owner wants to pass on
  -- cheaper for just that batch. Purchase price stays the FIFO cost driver;
  -- this only affects what a customer is charged when this batch is sold
  -- (Sales module, not built yet — recorded now so the data exists when it
  -- is).
  add column if not exists selling_price_override numeric(10, 2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'purchase_entries_selling_price_override_check') then
    alter table public.purchase_entries
      add constraint purchase_entries_selling_price_override_check
        check (selling_price_override is null or selling_price_override > 0);
  end if;
end;
$$;

-- Backfill existing rows (from before this migration): nothing could have
-- been sold against them yet (Sales/Service don't exist as modules yet), so
-- remaining_quantity = quantity is accurate for every pre-existing entry.
-- Batch numbers are backfilled in purchase_date order so earlier purchases
-- keep lower numbers, matching what next_batch_number() would have assigned
-- had it existed when they were created. Only touches rows with no
-- batch_number yet and continues numbering after the highest one already
-- assigned, so re-running this after a partial prior run neither
-- reassigns nor duplicates a batch number.
do $$
declare
  v_row record;
  v_seq integer;
begin
  select coalesce(max(substring(batch_number from 7)::integer), 0) into v_seq
    from public.purchase_entries
    where batch_number is not null;

  for v_row in
    select id from public.purchase_entries
      where batch_number is null
      order by purchase_date asc, created_at asc
  loop
    v_seq := v_seq + 1;
    update public.purchase_entries
      set batch_number = 'BATCH-' || lpad(v_seq::text, 6, '0'),
          remaining_quantity = coalesce(remaining_quantity, quantity)
      where id = v_row.id;
  end loop;
end;
$$;

-- SET NOT NULL is naturally idempotent (a no-op if already set) — kept
-- separate from the guarded ADD CONSTRAINT block below since a multi-clause
-- ALTER TABLE applies all clauses atomically, and ADD CONSTRAINT isn't
-- safely repeatable without its own guard.
alter table public.purchase_entries
  alter column batch_number set not null,
  alter column remaining_quantity set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'purchase_entries_batch_number_key') then
    alter table public.purchase_entries add constraint purchase_entries_batch_number_key unique (batch_number);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'purchase_entries_remaining_quantity_check') then
    alter table public.purchase_entries add constraint purchase_entries_remaining_quantity_check check (remaining_quantity >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'purchase_entries_remaining_lte_quantity_check') then
    alter table public.purchase_entries add constraint purchase_entries_remaining_lte_quantity_check check (remaining_quantity <= quantity);
  end if;
end;
$$;

-- Links each stock_movements row to the specific batch it increased/came
-- from. Null for movements that predate this migration.
alter table public.stock_movements
  add column if not exists purchase_entry_id uuid references public.purchase_entries (id) on delete restrict;

create index if not exists stock_movements_purchase_entry_idx on public.stock_movements (purchase_entry_id);

-- Sequence-backed batch number generator — same pattern as
-- next_inventory_sku() (0003_inventory_custom_type_sku.sql): a real DB
-- sequence, so concurrent purchases/corrections can never collide on the
-- generated batch number.
create sequence if not exists public.purchase_batch_number_seq;

select setval(
  'public.purchase_batch_number_seq',
  greatest(1, (select count(*) from public.purchase_entries))
);

create or replace function public.next_batch_number()
returns text
language sql
as $$
  select 'BATCH-' || lpad(nextval('public.purchase_batch_number_seq')::text, 6, '0');
$$;

-- ---------------------------------------------------------------------------
-- adjust_stock(): rewritten for FIFO batch consumption.
--
-- New optional params:
--   p_purchase_entry_id — an EXPLICIT single batch to target, instead of
--     generic FIFO. Used for: (a) a PURCHASE increase, where the caller
--     already inserted the batch row and knows its id, and (b) a
--     PURCHASE_RETURN decrease, which always targets the specific batch
--     being returned against, never FIFO.
--   p_unit_cost — only consulted for an increase with no explicit
--     p_purchase_entry_id (Opening Stock / a positive Manual Correction) —
--     a synthetic batch is created at this cost, or at the item's most
--     recent batch cost if omitted.
--
-- Behavior:
--   delta > 0, p_purchase_entry_id given  → straightforward increase against
--     that batch (its remaining_quantity was already set at insert time).
--   delta > 0, p_purchase_entry_id null   → creates a synthetic batch first
--     (Opening Stock / positive Manual Correction), then increases against it.
--   delta < 0, p_purchase_entry_id given  → decreases that one batch only
--     (Purchase Return).
--   delta < 0, p_purchase_entry_id null   → FIFO: walks this item's batches
--     oldest purchase_date first, draining each (splitting across batches
--     as needed) until the full amount is consumed. If the sum of all
--     remaining batches can't cover it, the loop leaves work partially
--     applied and then raises — which is safe, not a bug: an unhandled
--     exception aborts the whole calling transaction, so nothing from this
--     function ever partially commits.
-- ---------------------------------------------------------------------------

-- CREATE OR REPLACE only replaces a function whose argument list matches
-- exactly — since this adds two new parameters, without this DROP it would
-- silently create a second overloaded "adjust_stock" alongside the original
-- 5-argument one from 0001/0009, instead of replacing it. That ambiguity is
-- exactly what caused "function name is not unique" when this migration was
-- first run.
drop function if exists public.adjust_stock(uuid, integer, public.stock_movement_reason, text, text);

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

  -- Admin-only reasons: Purchases, Purchase Returns, Service usage, and any
  -- manual correction/damage write-off.
  if p_reason in ('PURCHASE', 'PURCHASE_RETURN', 'SERVICE_USAGE', 'MANUAL_CORRECTION', 'DAMAGE')
     and v_role is distinct from 'admin' then
    raise exception 'Only Administrators can record % stock movements', p_reason
      using errcode = '42501';
  end if;

  -- Admin or Sales Person: Sales and Online Order dispatch.
  if p_reason in ('SALE', 'ONLINE_ORDER_DISPATCH')
     and v_role is distinct from 'admin'
     and v_role is distinct from 'sales_person' then
    raise exception 'Not authorized to record % stock movements', p_reason
      using errcode = '42501';
  end if;

  if p_reason in ('MANUAL_CORRECTION', 'DAMAGE', 'PURCHASE_RETURN') and (p_note is null or btrim(p_note) = '') then
    raise exception 'A note is required for % adjustments', p_reason
      using errcode = '22023';
  end if;

  if p_delta > 0 then
    -- An increase always needs a batch — create a synthetic one if the
    -- caller didn't already create/identify one (record_purchase_entry()
    -- always passes p_purchase_entry_id; Opening Stock / a positive Manual
    -- Correction don't, so one is created here).
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
        (inventory_item_id, quantity, unit_price, remaining_quantity, supplier_name, purchase_date, note, created_by, batch_number)
      values
        (p_item_id, p_delta, v_cost, p_delta, null, now(), p_note, auth.uid(), public.next_batch_number())
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

    -- Not enough stock across all batches combined. Raising here aborts the
    -- whole transaction (including this function's own partial work above),
    -- so nothing partially commits — see the comment block above this
    -- function for why that's safe rather than a bug.
    if v_remaining_to_consume > 0 then
      raise exception 'Insufficient stock, or item % not found', p_item_id using errcode = 'P0001';
    end if;
  end if;

  return v_new_balance;
end;
$$;

-- Explicit argument types here (rather than bare function name) so this
-- never becomes ambiguous again if another overload is ever added.
grant execute on function public.adjust_stock(
  uuid, integer, public.stock_movement_reason, text, text, uuid, numeric
) to authenticated;

-- ---------------------------------------------------------------------------
-- record_purchase_entry(): now creates the batch itself (with a generated
-- batch_number) BEFORE calling adjust_stock(), passing that batch's id
-- through explicitly so adjust_stock() treats it as a plain increase
-- against an already-known batch, not FIFO/synthetic-batch logic.
-- ---------------------------------------------------------------------------

-- record_purchase_entry gains a 7th parameter (p_selling_price_override)
-- here — same overload trap as adjust_stock above: since 0009 only ever
-- shipped the 6-arg version, CREATE OR REPLACE with a 7th param would
-- create a second overload rather than replace it. Drop the old signature
-- first.
drop function if exists public.record_purchase_entry(uuid, integer, numeric, timestamptz, text, text);

create or replace function public.record_purchase_entry(
  p_inventory_item_id uuid,
  p_quantity integer,
  p_unit_price numeric,
  p_purchase_date timestamptz,
  p_supplier_name text default null,
  p_note text default null,
  p_selling_price_override numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_item_active boolean;
begin
  if p_quantity <= 0 then
    raise exception 'Quantity must be greater than zero' using errcode = '22023';
  end if;
  if p_unit_price <= 0 then
    raise exception 'Purchase price must be greater than zero' using errcode = '22023';
  end if;
  if p_selling_price_override is not null and p_selling_price_override <= 0 then
    raise exception 'Selling price override must be greater than zero' using errcode = '22023';
  end if;

  select is_active into v_item_active from public.inventory_items where id = p_inventory_item_id;

  if v_item_active is null then
    raise exception 'Inventory item % not found', p_inventory_item_id using errcode = 'P0002';
  end if;
  if not v_item_active then
    raise exception 'Cannot record a purchase against an inactive item' using errcode = '22023';
  end if;

  insert into public.purchase_entries
    (inventory_item_id, quantity, unit_price, remaining_quantity, supplier_name, purchase_date, note, created_by, batch_number, selling_price_override)
  values
    (p_inventory_item_id, p_quantity, p_unit_price, p_quantity, nullif(btrim(p_supplier_name), ''), p_purchase_date, p_note, auth.uid(), public.next_batch_number(), p_selling_price_override)
  returning id into v_entry_id;

  -- adjust_stock() enforces PURCHASE-reason admin authorization and is the
  -- sole path that mutates available_quantity — not duplicated here. Passing
  -- the batch id explicitly means it's treated as a plain increase against
  -- this known batch, not FIFO/synthetic-batch creation.
  perform public.adjust_stock(p_inventory_item_id, p_quantity, 'PURCHASE', 'purchases', p_note, v_entry_id);

  -- The item's purchase_price is now a reference/suggested price only (pre-
  -- fills the next Purchase Entry form) — no longer the authoritative cost;
  -- that lives per-batch now (doc/purchase-batch-fifo-scope.md §4).
  update public.inventory_items
    set purchase_price = p_unit_price
    where id = p_inventory_item_id;

  return v_entry_id;
end;
$$;

-- Explicit argument types (same reasoning as adjust_stock's grant above).
grant execute on function public.record_purchase_entry(
  uuid, integer, numeric, timestamptz, text, text, numeric
) to authenticated;

-- ---------------------------------------------------------------------------
-- record_purchase_return(): the return limit is now the batch's own
-- remaining_quantity directly — which already accounts for anything sold
-- out of this batch via FIFO AND any prior returns against it, since both
-- decrement the same column. The old "sum of prior purchase_returns"
-- calculation is gone; it would have let staff "return" units that were
-- actually already sold to a customer.
-- ---------------------------------------------------------------------------

create or replace function public.record_purchase_return(
  p_purchase_entry_id uuid,
  p_quantity integer,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry record;
  v_return_id uuid;
begin
  if p_quantity <= 0 then
    raise exception 'Return quantity must be greater than zero' using errcode = '22023';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required for a purchase return' using errcode = '22023';
  end if;

  select * into v_entry from public.purchase_entries where id = p_purchase_entry_id for update;
  if not found then
    raise exception 'Purchase entry % not found', p_purchase_entry_id using errcode = 'P0002';
  end if;

  if p_quantity > v_entry.remaining_quantity then
    raise exception 'Cannot return % units — only % remaining on this batch (some may already be sold or returned)',
      p_quantity, v_entry.remaining_quantity
      using errcode = '22023';
  end if;

  -- adjust_stock() enforces PURCHASE_RETURN admin authorization and the
  -- required-note rule, decrements this specific batch's remaining_quantity
  -- (p_purchase_entry_id is given, so it's not FIFO), and is the sole path
  -- that mutates available_quantity.
  perform public.adjust_stock(v_entry.inventory_item_id, -p_quantity, 'PURCHASE_RETURN', 'purchases', p_reason, p_purchase_entry_id);

  insert into public.purchase_returns
    (purchase_entry_id, inventory_item_id, quantity, reason, created_by)
  values
    (p_purchase_entry_id, v_entry.inventory_item_id, p_quantity, p_reason, auth.uid())
  returning id into v_return_id;

  return v_return_id;
end;
$$;

grant execute on function public.record_purchase_return to authenticated;
