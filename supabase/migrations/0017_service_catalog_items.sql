-- Service Catalog — Default Inventory Items (doc/service-module-scope.md
-- §3, Revision 3). Lets a General Service Package or Specific Service link
-- one or more inventory items with a default quantity each — e.g.
-- "Standard Service" -> 1L Engine Oil x1, Oil Filter x1. When staff pick
-- that package/service on a Service Job, these auto-populate Parts Used.
--
-- Catalog writes move from direct table INSERT/UPDATE (as shipped in
-- 0016) to SECURITY DEFINER functions here, because creating/editing a
-- package now needs to atomically write both the base row and its linked
-- items — same "one function is the only path that does this" reasoning
-- as every other multi-table write in this codebase. The old direct-table
-- RLS insert/update policies from 0016 are left in place (harmless,
-- unused by the app) rather than dropped, to keep this migration additive.
--
-- Idempotency note (see 0010/0011/0013/0016 headers): every statement here
-- is guarded to be safely re-runnable.

-- ---------------------------------------------------------------------------
-- 1. Junction tables
-- ---------------------------------------------------------------------------

create table if not exists public.general_service_package_items (
  id uuid primary key default gen_random_uuid(),
  general_service_package_id uuid not null references public.general_service_packages (id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items (id) on delete restrict,
  default_quantity integer not null default 1 check (default_quantity > 0),
  created_at timestamptz not null default now(),
  constraint general_service_package_items_unique unique (general_service_package_id, inventory_item_id)
);

create table if not exists public.specific_service_items (
  id uuid primary key default gen_random_uuid(),
  specific_service_id uuid not null references public.specific_services (id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items (id) on delete restrict,
  default_quantity integer not null default 1 check (default_quantity > 0),
  created_at timestamptz not null default now(),
  constraint specific_service_items_unique unique (specific_service_id, inventory_item_id)
);

create index if not exists general_service_package_items_pkg_idx on public.general_service_package_items (general_service_package_id);
create index if not exists specific_service_items_svc_idx on public.specific_service_items (specific_service_id);

-- ---------------------------------------------------------------------------
-- 2. replace_*_items() — internal helpers, delete-and-reinsert every linked
--    item for a package/service. Same full-replace pattern already used by
--    replace_service_job_lines() (0016) — no per-item edit history needed.
--    p_items shape: [{"inventory_item_id":"...","default_quantity":1}, ...]
-- ---------------------------------------------------------------------------

create or replace function public.replace_general_service_package_items(
  p_package_id uuid,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_item_id uuid;
  v_qty integer;
begin
  delete from public.general_service_package_items where general_service_package_id = p_package_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_item_id := (v_item ->> 'inventory_item_id')::uuid;
    v_qty := coalesce((v_item ->> 'default_quantity')::integer, 1);
    if v_item_id is null then
      raise exception 'A default item requires an inventory_item_id' using errcode = '22023';
    end if;
    if v_qty <= 0 then
      raise exception 'Default quantity must be greater than zero' using errcode = '22023';
    end if;
    insert into public.general_service_package_items (general_service_package_id, inventory_item_id, default_quantity)
    values (p_package_id, v_item_id, v_qty)
    on conflict (general_service_package_id, inventory_item_id) do update set default_quantity = excluded.default_quantity;
  end loop;
end;
$$;

create or replace function public.replace_specific_service_items(
  p_service_id uuid,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_item_id uuid;
  v_qty integer;
begin
  delete from public.specific_service_items where specific_service_id = p_service_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_item_id := (v_item ->> 'inventory_item_id')::uuid;
    v_qty := coalesce((v_item ->> 'default_quantity')::integer, 1);
    if v_item_id is null then
      raise exception 'A default item requires an inventory_item_id' using errcode = '22023';
    end if;
    if v_qty <= 0 then
      raise exception 'Default quantity must be greater than zero' using errcode = '22023';
    end if;
    insert into public.specific_service_items (specific_service_id, inventory_item_id, default_quantity)
    values (p_service_id, v_item_id, v_qty)
    on conflict (specific_service_id, inventory_item_id) do update set default_quantity = excluded.default_quantity;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. General Service Package create/update — now the sole write path
--    (replaces 0016's direct-table insert/update from the app layer).
-- ---------------------------------------------------------------------------

create or replace function public.create_general_service_package(
  p_name text,
  p_included_items text[],
  p_service_charge numeric,
  p_items jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_id uuid;
begin
  v_role := (auth.jwt() -> 'user_metadata' ->> 'role');
  if v_role is distinct from 'admin' then
    raise exception 'Only Administrators can manage the Service Catalog' using errcode = '42501';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'Name is required' using errcode = '22023';
  end if;
  if p_service_charge is null or p_service_charge < 0 then
    raise exception 'Service charge must be zero or greater' using errcode = '22023';
  end if;

  insert into public.general_service_packages (name, included_items, service_charge)
  values (btrim(p_name), coalesce(p_included_items, '{}'), p_service_charge)
  returning id into v_id;

  perform public.replace_general_service_package_items(v_id, p_items);

  return v_id;
end;
$$;

grant execute on function public.create_general_service_package(text, text[], numeric, jsonb) to authenticated;

create or replace function public.update_general_service_package(
  p_id uuid,
  p_name text,
  p_included_items text[],
  p_service_charge numeric,
  p_items jsonb default '[]'::jsonb
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
  if v_role is distinct from 'admin' then
    raise exception 'Only Administrators can manage the Service Catalog' using errcode = '42501';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'Name is required' using errcode = '22023';
  end if;
  if p_service_charge is null or p_service_charge < 0 then
    raise exception 'Service charge must be zero or greater' using errcode = '22023';
  end if;

  update public.general_service_packages
    set name = btrim(p_name), included_items = coalesce(p_included_items, '{}'), service_charge = p_service_charge
    where id = p_id;

  if not found then
    raise exception 'General Service Package % not found', p_id using errcode = 'P0002';
  end if;

  perform public.replace_general_service_package_items(p_id, p_items);
end;
$$;

grant execute on function public.update_general_service_package(uuid, text, text[], numeric, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Specific Service create/update — same shape as §3.
-- ---------------------------------------------------------------------------

create or replace function public.create_specific_service(
  p_name text,
  p_default_charge numeric,
  p_items jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_id uuid;
begin
  v_role := (auth.jwt() -> 'user_metadata' ->> 'role');
  if v_role is distinct from 'admin' then
    raise exception 'Only Administrators can manage the Service Catalog' using errcode = '42501';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'Name is required' using errcode = '22023';
  end if;
  if p_default_charge is not null and p_default_charge < 0 then
    raise exception 'Default charge must be zero or greater' using errcode = '22023';
  end if;

  insert into public.specific_services (name, default_charge)
  values (btrim(p_name), p_default_charge)
  returning id into v_id;

  perform public.replace_specific_service_items(v_id, p_items);

  return v_id;
end;
$$;

grant execute on function public.create_specific_service(text, numeric, jsonb) to authenticated;

create or replace function public.update_specific_service(
  p_id uuid,
  p_name text,
  p_default_charge numeric,
  p_items jsonb default '[]'::jsonb
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
  if v_role is distinct from 'admin' then
    raise exception 'Only Administrators can manage the Service Catalog' using errcode = '42501';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'Name is required' using errcode = '22023';
  end if;
  if p_default_charge is not null and p_default_charge < 0 then
    raise exception 'Default charge must be zero or greater' using errcode = '22023';
  end if;

  update public.specific_services
    set name = btrim(p_name), default_charge = p_default_charge
    where id = p_id;

  if not found then
    raise exception 'Specific Service % not found', p_id using errcode = 'P0002';
  end if;

  perform public.replace_specific_service_items(p_id, p_items);
end;
$$;

grant execute on function public.update_specific_service(uuid, text, numeric, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Row Level Security — admin-only read; writes only via the SECURITY
--    DEFINER functions above (same immutable-audit-trail-adjacent pattern
--    as every junction/line table in this schema).
-- ---------------------------------------------------------------------------

alter table public.general_service_package_items enable row level security;
alter table public.specific_service_items enable row level security;

create policy "general_service_package_items_admin_select" on public.general_service_package_items
  for select using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

create policy "specific_service_items_admin_select" on public.specific_service_items
  for select using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');
