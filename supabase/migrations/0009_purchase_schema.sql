-- Purchase Management schema.
-- Covers: purchase_entries, purchase_returns, the record_purchase_entry() /
-- record_purchase_return() functions, and an updated adjust_stock() that
-- recognizes the new PURCHASE_RETURN reason (added in
-- 0008_purchase_return_reason.sql).
-- See doc/purchase-module-scope.md for the confirmed feature/use-case list
-- this schema implements.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.purchase_entries (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items (id) on delete restrict,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12, 2) not null check (unit_price > 0),
  -- Computed at the DB level (not just in the app) so it stays correct
  -- regardless of which client wrote the row.
  total_amount numeric(14, 2) generated always as (quantity * unit_price) stored,
  -- Free-text only (§5 of the scope doc) — no Supplier master table.
  supplier_name text,
  purchase_date timestamptz not null,
  note text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index purchase_entries_item_idx on public.purchase_entries (inventory_item_id, purchase_date desc);
create index purchase_entries_date_idx on public.purchase_entries (purchase_date desc);

create table public.purchase_returns (
  id uuid primary key default gen_random_uuid(),
  purchase_entry_id uuid not null references public.purchase_entries (id) on delete restrict,
  -- Denormalized from purchase_entries for simpler queries/reporting; the
  -- source of truth for "which item" is still purchase_entry_id.
  inventory_item_id uuid not null references public.inventory_items (id) on delete restrict,
  quantity integer not null check (quantity > 0),
  reason text not null check (btrim(reason) <> ''),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index purchase_returns_entry_idx on public.purchase_returns (purchase_entry_id);

-- ---------------------------------------------------------------------------
-- adjust_stock(): re-declared (CREATE OR REPLACE, same signature) to extend
-- its per-reason authorization/validation rules to PURCHASE_RETURN. This
-- keeps adjust_stock() as the ONLY function that ever writes
-- inventory_items.available_quantity — record_purchase_entry() and
-- record_purchase_return() below both call it rather than touching
-- available_quantity directly.
-- ---------------------------------------------------------------------------

create or replace function public.adjust_stock(
  p_item_id uuid,
  p_delta integer,
  p_reason public.stock_movement_reason,
  p_source_module text,
  p_note text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_new_balance integer;
begin
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

  -- Atomic, race-safe: the WHERE clause re-checks the balance at write time,
  -- so two concurrent calls can never both succeed and drive stock negative.
  update public.inventory_items
    set available_quantity = available_quantity + p_delta
    where id = p_item_id
      and available_quantity + p_delta >= 0
    returning available_quantity into v_new_balance;

  if not found then
    raise exception 'Insufficient stock, or item % not found', p_item_id
      using errcode = 'P0001';
  end if;

  insert into public.stock_movements
    (inventory_item_id, delta, resulting_balance, reason, source_module, note, created_by)
  values
    (p_item_id, p_delta, v_new_balance, p_reason, p_source_module, p_note, auth.uid());

  return v_new_balance;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_purchase_entry(): the ONLY way to record a Purchase. Wraps the
-- purchase_entries insert and the stock increase (via adjust_stock, reason
-- PURCHASE) in one transaction, and syncs the item's reference purchase_price
-- to this purchase's unit price (confirmed default — scope doc §2).
-- ---------------------------------------------------------------------------

create or replace function public.record_purchase_entry(
  p_inventory_item_id uuid,
  p_quantity integer,
  p_unit_price numeric,
  p_purchase_date timestamptz,
  p_supplier_name text default null,
  p_note text default null
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

  select is_active into v_item_active from public.inventory_items where id = p_inventory_item_id;

  if v_item_active is null then
    raise exception 'Inventory item % not found', p_inventory_item_id using errcode = 'P0002';
  end if;
  if not v_item_active then
    raise exception 'Cannot record a purchase against an inactive item' using errcode = '22023';
  end if;

  -- adjust_stock() enforces PURCHASE-reason admin authorization and is the
  -- sole path that mutates available_quantity — not duplicated here.
  perform public.adjust_stock(p_inventory_item_id, p_quantity, 'PURCHASE', 'purchases', p_note);

  update public.inventory_items
    set purchase_price = p_unit_price
    where id = p_inventory_item_id;

  insert into public.purchase_entries
    (inventory_item_id, quantity, unit_price, supplier_name, purchase_date, note, created_by)
  values
    (p_inventory_item_id, p_quantity, p_unit_price, nullif(btrim(p_supplier_name), ''), p_purchase_date, p_note, auth.uid())
  returning id into v_entry_id;

  return v_entry_id;
end;
$$;

grant execute on function public.record_purchase_entry to authenticated;

-- ---------------------------------------------------------------------------
-- record_purchase_return(): the ONLY way to record a Purchase Return.
-- Locks the source purchase_entries row (FOR UPDATE) so two concurrent
-- returns against the same entry can never both succeed past its remaining
-- quantity, decreases stock via adjust_stock (reason PURCHASE_RETURN), and
-- inserts the purchase_returns row, all atomically.
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
  v_already_returned integer;
  v_remaining integer;
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

  select coalesce(sum(quantity), 0) into v_already_returned
    from public.purchase_returns where purchase_entry_id = p_purchase_entry_id;
  v_remaining := v_entry.quantity - v_already_returned;

  if p_quantity > v_remaining then
    raise exception 'Cannot return % units — only % remaining on this purchase', p_quantity, v_remaining
      using errcode = '22023';
  end if;

  -- adjust_stock() enforces PURCHASE_RETURN admin authorization and the
  -- required-note rule, and is the sole path that mutates available_quantity.
  perform public.adjust_stock(v_entry.inventory_item_id, -p_quantity, 'PURCHASE_RETURN', 'purchases', p_reason);

  insert into public.purchase_returns
    (purchase_entry_id, inventory_item_id, quantity, reason, created_by)
  values
    (p_purchase_entry_id, v_entry.inventory_item_id, p_quantity, p_reason, auth.uid())
  returning id into v_return_id;

  return v_return_id;
end;
$$;

grant execute on function public.record_purchase_return to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.purchase_entries enable row level security;
alter table public.purchase_returns enable row level security;

-- Admin-only read; no insert/update/delete policy on either table at all —
-- writes only happen through the two SECURITY DEFINER functions above
-- (which bypass RLS), keeping both tables immutable via direct API access,
-- exactly matching stock_movements' pattern (see 0001_inventory_schema.sql)
-- and the scope doc's "never edited/deleted" rule (§3).
create policy "purchase_entries_admin_select" on public.purchase_entries
  for select using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

create policy "purchase_returns_admin_select" on public.purchase_returns
  for select using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');
