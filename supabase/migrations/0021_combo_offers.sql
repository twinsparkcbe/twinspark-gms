-- Combo Offers (doc/service-combo-offers-plan.md).
--
-- A Combo is a fixed-price bundle: one advertised price covering a set of
-- services and parts (the ₹7,499 poster — front/rear tyres with fitting,
-- General Service, water wash, foam wash, chain clean). Two things make it
-- different from a General Service Package, and are why this is new tables
-- rather than more columns on that one:
--
--   1. Components can be INCLUDED — they leave stock but add nothing to the
--      bill, because the combo price already covers them. A package's linked
--      items always bill at their own selling price, and that must not change
--      for the packages already in use.
--   2. A combo can contain other catalog entries (packages, specific
--      services), not just inventory items.
--
-- Named `combos`, not `service_combos`: confirmed decision is that combos
-- sell from Sales as well as Service, so the definition is shared and neither
-- module owns it. Each host module keeps its own rules around it — Service
-- deducts stock at completion, Sales deducts immediately.
--
-- Fitting: a combo that contains tyres absorbs the fitting charge in its
-- price. No INSTALLATION line is generated for a combo. Ordinary tyre sales
-- are untouched and still charge wheel_count x ₹300 (0013 §record_sale).
--
-- Idempotency note (see 0010/0011/0013/0016/0017 headers): every statement
-- here is guarded to be safely re-runnable.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

create table if not exists public.combos (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,

  -- The advertised price. Covers every INCLUDED component; EXTRA components
  -- bill on top at their own price.
  combo_price numeric(12, 2) not null check (combo_price >= 0),

  -- Offer window. Both optional: null valid_from means "running since
  -- forever", null valid_to means "no end date". Independent of is_active —
  -- a combo can be inside its window but switched off, and an expired combo
  -- stays resolvable for the jobs and sales that already used it.
  valid_from date,
  valid_to date,

  -- Never hard-deleted (same convention as every catalog in this schema).
  is_active boolean not null default true,
  created_at timestamptz not null default now(),

  constraint combos_name_key unique (name),
  constraint combos_valid_window check (valid_from is null or valid_to is null or valid_to >= valid_from)
);

create table if not exists public.combo_components (
  id uuid primary key default gen_random_uuid(),
  combo_id uuid not null references public.combos (id) on delete cascade,
  position integer not null,

  -- Exactly one of the three references below is set, per component_type.
  component_type text not null check (component_type in ('PACKAGE', 'SPECIFIC', 'ITEM')),
  general_service_package_id uuid references public.general_service_packages (id) on delete restrict,
  specific_service_id uuid references public.specific_services (id) on delete restrict,
  inventory_item_id uuid references public.inventory_items (id) on delete restrict,

  quantity integer not null default 1 check (quantity > 0),

  -- INCLUDED: covered by combo_price, contributes ₹0 to the bill (but still
  -- moves stock, and still carries its purchase price into COGS).
  -- EXTRA: billed on top at its own catalog price.
  pricing text not null default 'INCLUDED' check (pricing in ('INCLUDED', 'EXTRA')),

  created_at timestamptz not null default now(),

  constraint combo_components_shape check (
    (component_type = 'PACKAGE' and general_service_package_id is not null and specific_service_id is null and inventory_item_id is null)
    or (component_type = 'SPECIFIC' and specific_service_id is not null and general_service_package_id is null and inventory_item_id is null)
    or (component_type = 'ITEM' and inventory_item_id is not null and general_service_package_id is null and specific_service_id is null)
  )
);

create index if not exists combo_components_combo_idx on public.combo_components (combo_id);
create index if not exists combos_active_idx on public.combos (is_active);

-- One row per referenced thing — a second "Engine Oil" line is a quantity
-- change, not another row. Partial uniques because only one column is
-- populated per component_type.
create unique index if not exists combo_components_package_unique
  on public.combo_components (combo_id, general_service_package_id)
  where general_service_package_id is not null;
create unique index if not exists combo_components_specific_unique
  on public.combo_components (combo_id, specific_service_id)
  where specific_service_id is not null;
create unique index if not exists combo_components_item_unique
  on public.combo_components (combo_id, inventory_item_id)
  where inventory_item_id is not null;

-- ---------------------------------------------------------------------------
-- 2. replace_combo_components() — internal helper. Delete-and-reinsert, the
--    same full-replace pattern as replace_general_service_package_items()
--    (0017) and replace_service_job_lines() (0016): no per-component edit
--    history is wanted, the combo definition is simply whatever it is now.
--
--    p_components shape:
--      [{"component_type":"ITEM","inventory_item_id":"...","quantity":2,
--        "pricing":"INCLUDED"}, ...]
-- ---------------------------------------------------------------------------

create or replace function public.replace_combo_components(
  p_combo_id uuid,
  p_components jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_component jsonb;
  v_type text;
  v_qty integer;
  v_pricing text;
  v_package_id uuid;
  v_specific_id uuid;
  v_item_id uuid;
  v_position integer := 0;
begin
  delete from public.combo_components where combo_id = p_combo_id;

  for v_component in select * from jsonb_array_elements(coalesce(p_components, '[]'::jsonb))
  loop
    v_type := v_component ->> 'component_type';
    v_qty := coalesce((v_component ->> 'quantity')::integer, 1);
    v_pricing := coalesce(v_component ->> 'pricing', 'INCLUDED');
    v_package_id := nullif(v_component ->> 'general_service_package_id', '')::uuid;
    v_specific_id := nullif(v_component ->> 'specific_service_id', '')::uuid;
    v_item_id := nullif(v_component ->> 'inventory_item_id', '')::uuid;

    if v_type not in ('PACKAGE', 'SPECIFIC', 'ITEM') then
      raise exception 'Unknown combo component type %', coalesce(v_type, '(null)') using errcode = '22023';
    end if;
    if v_pricing not in ('INCLUDED', 'EXTRA') then
      raise exception 'Combo component pricing must be INCLUDED or EXTRA' using errcode = '22023';
    end if;
    if v_qty <= 0 then
      raise exception 'Combo component quantity must be greater than zero' using errcode = '22023';
    end if;

    -- Mirrors combo_components_shape, but raised as a readable message
    -- before the constraint fires with a generic one.
    if v_type = 'PACKAGE' and v_package_id is null then
      raise exception 'A PACKAGE component requires general_service_package_id' using errcode = '22023';
    end if;
    if v_type = 'SPECIFIC' and v_specific_id is null then
      raise exception 'A SPECIFIC component requires specific_service_id' using errcode = '22023';
    end if;
    if v_type = 'ITEM' and v_item_id is null then
      raise exception 'An ITEM component requires inventory_item_id' using errcode = '22023';
    end if;

    insert into public.combo_components
      (combo_id, position, component_type, general_service_package_id, specific_service_id, inventory_item_id, quantity, pricing)
    values
      (p_combo_id, v_position, v_type,
       case when v_type = 'PACKAGE' then v_package_id end,
       case when v_type = 'SPECIFIC' then v_specific_id end,
       case when v_type = 'ITEM' then v_item_id end,
       v_qty, v_pricing);

    v_position := v_position + 1;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. create/update — the sole write path, same shape as 0017's catalog
--    functions. Administrator-only: a Sales Person can sell a combo but
--    never define one.
-- ---------------------------------------------------------------------------

create or replace function public.create_combo(
  p_name text,
  p_description text,
  p_combo_price numeric,
  p_valid_from date default null,
  p_valid_to date default null,
  p_components jsonb default '[]'::jsonb
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
    raise exception 'Only Administrators can manage Combo Offers' using errcode = '42501';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'Name is required' using errcode = '22023';
  end if;
  if p_combo_price is null or p_combo_price < 0 then
    raise exception 'Combo price must be zero or greater' using errcode = '22023';
  end if;
  if p_valid_from is not null and p_valid_to is not null and p_valid_to < p_valid_from then
    raise exception 'The offer end date cannot be before its start date' using errcode = '22023';
  end if;
  -- A combo with nothing in it would bill a price for nothing.
  if p_components is null or jsonb_array_length(p_components) = 0 then
    raise exception 'A combo needs at least one component' using errcode = '22023';
  end if;

  insert into public.combos (name, description, combo_price, valid_from, valid_to)
  values (btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), p_combo_price, p_valid_from, p_valid_to)
  returning id into v_id;

  perform public.replace_combo_components(v_id, p_components);

  return v_id;
end;
$$;

grant execute on function public.create_combo(text, text, numeric, date, date, jsonb) to authenticated;

create or replace function public.update_combo(
  p_id uuid,
  p_name text,
  p_description text,
  p_combo_price numeric,
  p_valid_from date default null,
  p_valid_to date default null,
  p_components jsonb default '[]'::jsonb
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
    raise exception 'Only Administrators can manage Combo Offers' using errcode = '42501';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'Name is required' using errcode = '22023';
  end if;
  if p_combo_price is null or p_combo_price < 0 then
    raise exception 'Combo price must be zero or greater' using errcode = '22023';
  end if;
  if p_valid_from is not null and p_valid_to is not null and p_valid_to < p_valid_from then
    raise exception 'The offer end date cannot be before its start date' using errcode = '22023';
  end if;
  if p_components is null or jsonb_array_length(p_components) = 0 then
    raise exception 'A combo needs at least one component' using errcode = '22023';
  end if;

  update public.combos
    set name = btrim(p_name),
        description = nullif(btrim(coalesce(p_description, '')), ''),
        combo_price = p_combo_price,
        valid_from = p_valid_from,
        valid_to = p_valid_to
    where id = p_id;

  if not found then
    raise exception 'Combo % not found', p_id using errcode = 'P0002';
  end if;

  perform public.replace_combo_components(p_id, p_components);
end;
$$;

grant execute on function public.update_combo(uuid, text, text, numeric, date, date, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. duplicate_combo() — pinning exact products means one combo per tyre
--    fitment (plan §6.1). Cloning turns a ten-line rebuild into a two-field
--    edit. The copy is created INACTIVE deliberately: a half-edited clone
--    must not be sellable before someone has swapped the tyres and the name.
-- ---------------------------------------------------------------------------

create or replace function public.duplicate_combo(
  p_id uuid,
  p_new_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_new_id uuid;
begin
  v_role := (auth.jwt() -> 'user_metadata' ->> 'role');
  if v_role is distinct from 'admin' then
    raise exception 'Only Administrators can manage Combo Offers' using errcode = '42501';
  end if;
  if p_new_name is null or btrim(p_new_name) = '' then
    raise exception 'Name is required' using errcode = '22023';
  end if;

  insert into public.combos (name, description, combo_price, valid_from, valid_to, is_active)
  select btrim(p_new_name), description, combo_price, valid_from, valid_to, false
    from public.combos
   where id = p_id
  returning id into v_new_id;

  if v_new_id is null then
    raise exception 'Combo % not found', p_id using errcode = 'P0002';
  end if;

  insert into public.combo_components
    (combo_id, position, component_type, general_service_package_id, specific_service_id, inventory_item_id, quantity, pricing)
  select v_new_id, position, component_type, general_service_package_id, specific_service_id, inventory_item_id, quantity, pricing
    from public.combo_components
   where combo_id = p_id;

  return v_new_id;
end;
$$;

grant execute on function public.duplicate_combo(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. set_combo_active() — soft deactivate, never delete (doc §16 convention).
-- ---------------------------------------------------------------------------

create or replace function public.set_combo_active(
  p_id uuid,
  p_is_active boolean
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
    raise exception 'Only Administrators can manage Combo Offers' using errcode = '42501';
  end if;

  update public.combos set is_active = coalesce(p_is_active, true) where id = p_id;

  if not found then
    raise exception 'Combo % not found', p_id using errcode = 'P0002';
  end if;
end;
$$;

grant execute on function public.set_combo_active(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Row Level Security.
--
--    Read is admin OR sales_person — unlike the Service catalogs, which are
--    admin-only, because a Sales Person sells combos from the Sales screen
--    (confirmed decision 6). Defining a combo stays Administrator-only, and
--    is enforced in the SECURITY DEFINER functions above; there are no
--    insert/update/delete policies at all, so the functions are the only
--    write path.
-- ---------------------------------------------------------------------------

alter table public.combos enable row level security;
alter table public.combo_components enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'combos_select_staff') then
    create policy "combos_select_staff" on public.combos
      for select using ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin', 'sales_person'));
  end if;
  if not exists (select 1 from pg_policies where policyname = 'combo_components_select_staff') then
    create policy "combo_components_select_staff" on public.combo_components
      for select using ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin', 'sales_person'));
  end if;
end;
$$;
