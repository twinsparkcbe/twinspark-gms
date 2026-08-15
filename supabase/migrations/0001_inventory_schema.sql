-- Inventory Management schema.
-- Covers: categories, brands, inventory_items, stock_movements, and the
-- adjust_stock() function that is the ONLY path allowed to change
-- inventory_items.available_quantity (see doc/inventory-module-scope.md §4).
--
-- Role checks use auth.jwt() -> 'user_metadata' ->> 'role' rather than a
-- profiles table, because User Roles hasn't been built yet (per the module
-- workflow) — the app currently reads role the same way
-- (app/(app)/layout.tsx). Swap both places over to a profiles table join
-- together, when that module is built, not before.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create type public.item_type as enum (
  'TRACK_TYRE',
  'BRAND_NEW_TYRE',
  'ENGINE_OIL',
  'CHAIN',
  'SPROCKET_KIT',
  'BRAKE_PART',
  'LUBRICANT',
  'ACCESSORY',
  'OTHER_SPARE_PART'
);

create type public.stock_movement_reason as enum (
  'PURCHASE',
  'SALE',
  'SERVICE_USAGE',
  'ONLINE_ORDER_DISPATCH',
  'MANUAL_CORRECTION',
  'DAMAGE'
);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  constraint categories_name_key unique (name)
);

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  constraint brands_name_key unique (name)
);

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  item_type public.item_type not null,
  product_name text not null,
  sku_code text not null,
  category_id uuid references public.categories (id) on delete restrict,
  brand_id uuid references public.brands (id) on delete restrict,
  purchase_price numeric(12, 2) not null check (purchase_price > 0),
  selling_price numeric(12, 2) not null check (selling_price > 0),
  available_quantity integer not null default 0 check (available_quantity >= 0),
  low_stock_threshold integer not null default 0 check (low_stock_threshold >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Computed at the DB level (not just in the app) so filtering/pagination
  -- by stock status stays accurate — see INV-023/047-050.
  stock_status text generated always as (
    case
      when available_quantity <= 0 then 'out_of_stock'
      when available_quantity <= low_stock_threshold then 'low_stock'
      else 'in_stock'
    end
  ) stored,

  constraint inventory_items_sku_code_key unique (sku_code),

  -- Track Tyres (and every other non-Brand-New-Tyre type) never have a
  -- category/brand; Brand New Tyres always require both. (PRD §3.4/3.6)
  constraint inventory_items_category_brand_rule check (
    (item_type = 'BRAND_NEW_TYRE' and category_id is not null and brand_id is not null)
    or
    (item_type <> 'BRAND_NEW_TYRE' and category_id is null and brand_id is null)
  )
);

-- Prevents accidental duplicate SKUs: same type + brand + name, case-insensitive.
-- brand_id is coalesced so non-branded types (brand_id null) are compared
-- consistently instead of every NULL being treated as distinct.
-- Scoped to active items only, so a name can be reused after an old item is deactivated.
create unique index inventory_items_dedupe_idx
  on public.inventory_items (item_type, coalesce(brand_id::text, ''), lower(product_name))
  where is_active = true;

create index inventory_items_search_idx on public.inventory_items using gin (product_name gin_trgm_ops);
create index inventory_items_type_idx on public.inventory_items (item_type);
create index inventory_items_category_idx on public.inventory_items (category_id);
create index inventory_items_brand_idx on public.inventory_items (brand_id);
create index inventory_items_active_idx on public.inventory_items (is_active);
create index inventory_items_stock_status_idx on public.inventory_items (stock_status);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items (id) on delete restrict,
  delta integer not null,
  resulting_balance integer not null,
  reason public.stock_movement_reason not null,
  source_module text not null,
  note text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index stock_movements_item_idx on public.stock_movements (inventory_item_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at trigger (admin CRUD path only — adjust_stock() sets it manually)
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger inventory_items_set_updated_at
  before update on public.inventory_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- adjust_stock(): the ONLY function allowed to change available_quantity.
-- SECURITY DEFINER so it can write regardless of the admin-only table RLS
-- below — authorization for WHO can call it per reason is enforced inside
-- the function body instead, mirroring the module permission matrix.
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

  -- Admin-only reasons: Purchases, Service usage, and any manual
  -- correction/damage write-off.
  if p_reason in ('PURCHASE', 'SERVICE_USAGE', 'MANUAL_CORRECTION', 'DAMAGE')
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

  if p_reason in ('MANUAL_CORRECTION', 'DAMAGE') and (p_note is null or btrim(p_note) = '') then
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

grant execute on function public.adjust_stock to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.categories enable row level security;
alter table public.brands enable row level security;
alter table public.inventory_items enable row level security;
alter table public.stock_movements enable row level security;

-- Categories: any authenticated user can read (needed by Sales' Brand New
-- Tyre picker later); only Admin can write.
create policy "categories_select_authenticated" on public.categories
  for select using (auth.role() = 'authenticated');
create policy "categories_admin_insert" on public.categories
  for insert with check ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');
create policy "categories_admin_update" on public.categories
  for update using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');
create policy "categories_admin_delete" on public.categories
  for delete using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

-- Brands: same shape as categories.
create policy "brands_select_authenticated" on public.brands
  for select using (auth.role() = 'authenticated');
create policy "brands_admin_insert" on public.brands
  for insert with check ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');
create policy "brands_admin_update" on public.brands
  for update using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');
create policy "brands_admin_delete" on public.brands
  for delete using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

-- Inventory items: any authenticated user can read (Sales/Service pickers
-- need this later); only Admin can create/edit/delete via direct table
-- access. Quantity changes never go through these policies — they go
-- through adjust_stock() above, which has its own per-reason authorization.
create policy "inventory_items_select_authenticated" on public.inventory_items
  for select using (auth.role() = 'authenticated');
create policy "inventory_items_admin_insert" on public.inventory_items
  for insert with check ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');
create policy "inventory_items_admin_update" on public.inventory_items
  for update using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');
create policy "inventory_items_admin_delete" on public.inventory_items
  for delete using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

-- Stock movements: Admin-only read (Reports module); no direct insert/update/
-- delete policy at all — the only writer is adjust_stock(), which bypasses
-- RLS as a SECURITY DEFINER function.
create policy "stock_movements_admin_select" on public.stock_movements
  for select using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');
