-- Service Management schema — Revision 2 (doc/service-module-scope.md).
-- Covers: vehicles, the General Service Package / Specific Service catalog,
-- service_jobs and its unified service_job_lines, deferred-deduction
-- service_inventory_usage, service_job_events (timeline), service_job_images
-- (Before/After photos), and the create_service_job() / update_service_job()
-- / update_service_job_status() / complete_service_job() /
-- update_service_payment_status() / update_service_delivery_status()
-- functions.
--
-- Idempotency note (see 0010/0011/0013's headers — a real production
-- incident established this pattern): Supabase's SQL editor does not wrap a
-- pasted script in one all-or-nothing transaction, so every statement here
-- is guarded to be safely re-runnable regardless of how far a previous
-- attempt got.
--
-- No change needed to adjust_stock() or stock_movement_reason — SERVICE_USAGE
-- already exists (0001_inventory_schema.sql) and is already admin-gated
-- there. Service reuses it as-is (scope doc §7).

-- ---------------------------------------------------------------------------
-- 1. Vehicles
-- ---------------------------------------------------------------------------

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete restrict,
  vehicle_number text not null,
  vehicle_model text not null,
  -- Denormalized convenience (scope doc §2) — service_jobs.odometer_reading
  -- per visit is the source of truth; this is just "what to show" without a
  -- join when listing vehicles.
  latest_odometer_reading integer,
  created_at timestamptz not null default now()
);

-- Lookup key is vehicle_number, matched case-insensitively (registration
-- plates get typed in mixed case) — deliberately NOT a unique constraint:
-- a used bike can change owners, and create_service_job() below re-points
-- customer_id at whoever the current job is for rather than being blocked
-- by an old ownership record.
create index if not exists vehicles_number_idx on public.vehicles (lower(vehicle_number));
create index if not exists vehicles_customer_idx on public.vehicles (customer_id);

-- ---------------------------------------------------------------------------
-- 2. Service Catalog — General Service Packages & Specific Services
--    (scope doc §3, confirmed full admin CRUD so Reports can group by a
--    real "service type" instead of free text).
-- ---------------------------------------------------------------------------

create table if not exists public.general_service_packages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  included_items text[] not null default '{}',
  service_charge numeric(12, 2) not null check (service_charge >= 0),
  -- Never hard-deleted — a deactivated package must stay resolvable for
  -- historical jobs that already reference it (scope doc §16).
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint general_service_packages_name_key unique (name)
);

create table if not exists public.specific_services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Optional suggested price — editable per job (scope doc §9), so this is
  -- a default, not a lock.
  default_charge numeric(12, 2) check (default_charge is null or default_charge >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint specific_services_name_key unique (name)
);

create index if not exists general_service_packages_active_idx on public.general_service_packages (is_active);
create index if not exists specific_services_active_idx on public.specific_services (is_active);

-- ---------------------------------------------------------------------------
-- 3. Service Job
-- ---------------------------------------------------------------------------

create table if not exists public.service_jobs (
  id uuid primary key default gen_random_uuid(),
  -- Assigned immediately on first save, even DRAFT (scope doc §10) — own
  -- sequence, separate from invoice_number below.
  job_number text not null unique,
  -- Assigned only at completion (scope doc §7/§10) — null for every job
  -- that hasn't reached COMPLETED yet.
  invoice_number text unique,
  customer_id uuid not null references public.customers (id) on delete restrict,
  vehicle_id uuid not null references public.vehicles (id) on delete restrict,
  odometer_reading integer not null check (odometer_reading >= 0),

  -- Job status lifecycle (scope doc §5). text + check constraint, not a
  -- Postgres enum type — same reasoning as sale_items.line_type: a status
  -- added later never needs an ALTER TYPE migration.
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'IN_PROGRESS', 'READY_FOR_DELIVERY', 'COMPLETED', 'CANCELLED')),

  complaint_notes text,
  -- Internal only — never read by buildJobCardView()/buildServiceInvoiceView()
  -- (scope doc §14). Enforced at the view-builder level, not just RLS.
  mechanic_notes text,

  expected_delivery_at timestamptz,
  completed_at timestamptz,
  delivered_at timestamptz,

  -- Both null until COMPLETED (scope doc §11) — there's no invoice to pay
  -- or a bike to hand over before that.
  payment_status text check (payment_status is null or payment_status in ('PENDING', 'PARTIAL', 'PAID', 'FREE_SERVICE')),
  delivery_status text check (delivery_status is null or delivery_status in ('WAITING', 'READY_FOR_PICKUP', 'DELIVERED')),

  gst_applicable boolean not null default false,
  gst_amount numeric(12, 2) not null default 0 check (gst_amount >= 0),
  discount_applicable boolean not null default false,
  discount_amount numeric(12, 2) not null default 0 check (discount_amount >= 0),

  -- Aggregated by update_service_job()/complete_service_job() — only
  -- authoritative from COMPLETED onward; pre-completion values are a live
  -- working total for display, recomputed fresh every edit.
  subtotal numeric(14, 2) not null default 0,
  inventory_total numeric(14, 2) not null default 0,
  grand_total numeric(14, 2) not null default 0,

  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index if not exists service_jobs_customer_idx on public.service_jobs (customer_id, created_at desc);
create index if not exists service_jobs_vehicle_idx on public.service_jobs (vehicle_id, created_at desc);
create index if not exists service_jobs_status_idx on public.service_jobs (status);
-- Powers Pending Job Detection (scope doc §19) — active jobs for one vehicle.
create index if not exists service_jobs_vehicle_active_idx on public.service_jobs (vehicle_id)
  where status in ('DRAFT', 'IN_PROGRESS', 'READY_FOR_DELIVERY');

-- ---------------------------------------------------------------------------
-- 4. Service Job Lines — unified Package/Specific/Custom line shape
--    (scope doc §4/§8/§9), replaces the old either/or service_category design.
-- ---------------------------------------------------------------------------

create table if not exists public.service_job_lines (
  id uuid primary key default gen_random_uuid(),
  service_job_id uuid not null references public.service_jobs (id) on delete restrict,
  position integer not null,
  line_type text not null check (line_type in ('PACKAGE', 'SPECIFIC', 'CUSTOM')),

  -- Set only for the matching line_type; catalog FK kept for traceability,
  -- but description/rate below are the actual snapshot used everywhere
  -- (scope doc §16 — catalog price/name changes later never affect this row).
  general_service_package_id uuid references public.general_service_packages (id) on delete restrict,
  specific_service_id uuid references public.specific_services (id) on delete restrict,

  description text not null,
  quantity integer not null default 1 check (quantity > 0),
  rate numeric(12, 2) not null check (rate >= 0),
  amount numeric(14, 2) generated always as (quantity * rate) stored,

  created_at timestamptz not null default now(),

  constraint service_job_lines_shape check (
    (line_type = 'PACKAGE' and general_service_package_id is not null and specific_service_id is null)
    or (line_type = 'SPECIFIC' and specific_service_id is not null and general_service_package_id is null)
    or (line_type = 'CUSTOM' and general_service_package_id is null and specific_service_id is null)
  )
);

create index if not exists service_job_lines_job_idx on public.service_job_lines (service_job_id, position);

-- ---------------------------------------------------------------------------
-- 5. Service Inventory Usage — deferred deduction (scope doc §6/§7).
--    Adding/removing a row here is pure data entry; adjust_stock() is only
--    called for rows where stock_deducted is still false, and only from
--    complete_service_job() below.
-- ---------------------------------------------------------------------------

create table if not exists public.service_inventory_usage (
  id uuid primary key default gen_random_uuid(),
  service_job_id uuid not null references public.service_jobs (id) on delete restrict,
  inventory_item_id uuid not null references public.inventory_items (id) on delete restrict,
  -- Snapshot at the time the line is added (scope doc §16) — never a live
  -- join, so a later price change on the item doesn't rewrite history.
  item_name_snapshot text not null,
  quantity_used integer not null check (quantity_used > 0),
  unit_price_snapshot numeric(12, 2) not null check (unit_price_snapshot >= 0),
  line_total numeric(14, 2) generated always as (quantity_used * unit_price_snapshot) stored,
  -- Flips true the moment complete_service_job() successfully calls
  -- adjust_stock() for this row — lets that function be safely re-run
  -- without double-deducting if it's ever retried after a partial failure
  -- upstream of the stock loop (defense in depth; the function is already
  -- atomic, this just makes the row's own state legible).
  stock_deducted boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists service_inventory_usage_job_idx on public.service_inventory_usage (service_job_id);
create index if not exists service_inventory_usage_item_idx on public.service_inventory_usage (inventory_item_id);

-- ---------------------------------------------------------------------------
-- 6. Service Job Timeline (scope doc §15) — append-only, written only by the
--    functions below, never directly by staff.
-- ---------------------------------------------------------------------------

create table if not exists public.service_job_events (
  id uuid primary key default gen_random_uuid(),
  service_job_id uuid not null references public.service_jobs (id) on delete restrict,
  event_type text not null check (
    event_type in ('JOB_CREATED', 'STATUS_CHANGED', 'JOB_COMPLETED', 'PAYMENT_STATUS_CHANGED', 'DELIVERY_STATUS_CHANGED')
  ),
  detail text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index if not exists service_job_events_job_idx on public.service_job_events (service_job_id, created_at);

-- ---------------------------------------------------------------------------
-- 7. Before/After Images (scope doc §21 — optional, low-stakes).
-- ---------------------------------------------------------------------------

create table if not exists public.service_job_images (
  id uuid primary key default gen_random_uuid(),
  service_job_id uuid not null references public.service_jobs (id) on delete restrict,
  image_type text not null check (image_type in ('BEFORE', 'AFTER')),
  storage_path text not null,
  created_at timestamptz not null default now()
);

create index if not exists service_job_images_job_idx on public.service_job_images (service_job_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'service-job-images',
  'service-job-images',
  true,
  5242880, -- 5 MB, same limit as inventory-images
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'service_job_images_admin_insert') then
    create policy "service_job_images_admin_insert" on storage.objects
      for insert to authenticated
      with check (bucket_id = 'service-job-images' and (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');
  end if;
  if not exists (select 1 from pg_policies where policyname = 'service_job_images_admin_update') then
    create policy "service_job_images_admin_update" on storage.objects
      for update to authenticated
      using (bucket_id = 'service-job-images' and (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');
  end if;
  if not exists (select 1 from pg_policies where policyname = 'service_job_images_admin_delete') then
    create policy "service_job_images_admin_delete" on storage.objects
      for delete to authenticated
      using (bucket_id = 'service-job-images' and (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Numbering — two independent sequences (scope doc §10).
-- ---------------------------------------------------------------------------

create sequence if not exists public.service_job_number_seq;
create sequence if not exists public.service_invoice_number_seq;

create or replace function public.next_service_job_number()
returns text
language sql
as $$
  select 'SJ-' || lpad(nextval('public.service_job_number_seq')::text, 6, '0');
$$;

create or replace function public.next_service_invoice_number()
returns text
language sql
as $$
  select 'TW-J-' || lpad(nextval('public.service_invoice_number_seq')::text, 6, '0');
$$;

-- ---------------------------------------------------------------------------
-- 9. create_service_job() — the ONLY way to create a Service Job. Always
--    lands in DRAFT (scope doc §6). Finds-or-creates the Customer (reusing
--    Sales' customers table) and the Vehicle, inserts every line and every
--    inventory-usage row with NO stock deduction, assigns job_number, and
--    logs JOB_CREATED — all atomically.
--
--    p_lines shape (jsonb array), one object per line:
--      PACKAGE:  {"line_type":"PACKAGE","general_service_package_id":"...","quantity":1,"rate":450}
--      SPECIFIC: {"line_type":"SPECIFIC","specific_service_id":"...","quantity":1,"rate":150}
--      CUSTOM:   {"line_type":"CUSTOM","description":"...","quantity":1,"rate":200}
--    p_usage shape (jsonb array), one object per part used:
--      {"inventory_item_id":"...","quantity_used":2}
-- ---------------------------------------------------------------------------

create or replace function public.create_service_job(
  p_customer_name text,
  p_customer_mobile text,
  p_customer_address text,
  p_vehicle_number text,
  p_vehicle_model text,
  p_odometer_reading integer,
  p_complaint_notes text,
  p_mechanic_notes text,
  p_expected_delivery_at timestamptz,
  p_gst_applicable boolean,
  p_gst_amount numeric,
  p_discount_applicable boolean,
  p_discount_amount numeric,
  p_lines jsonb,
  p_usage jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_customer_id uuid;
  v_vehicle_id uuid;
  v_job_id uuid;
begin
  v_role := (auth.jwt() -> 'user_metadata' ->> 'role');
  if v_role is distinct from 'admin' then
    raise exception 'Only Administrators can create Service Jobs' using errcode = '42501';
  end if;

  if p_customer_mobile is null or btrim(p_customer_mobile) = '' then
    raise exception 'Customer mobile number is required' using errcode = '22023';
  end if;
  if p_customer_name is null or btrim(p_customer_name) = '' then
    raise exception 'Customer name is required' using errcode = '22023';
  end if;
  if p_vehicle_number is null or btrim(p_vehicle_number) = '' then
    raise exception 'Vehicle number is required' using errcode = '22023';
  end if;
  if p_vehicle_model is null or btrim(p_vehicle_model) = '' then
    raise exception 'Vehicle model is required' using errcode = '22023';
  end if;
  if p_odometer_reading is null or p_odometer_reading < 0 then
    raise exception 'A valid odometer reading is required' using errcode = '22023';
  end if;

  -- Find-or-create Customer by mobile number, same key Sales already uses.
  select id into v_customer_id from public.customers where mobile_number = btrim(p_customer_mobile);
  if v_customer_id is null then
    insert into public.customers (name, mobile_number, address)
    values (btrim(p_customer_name), btrim(p_customer_mobile), nullif(btrim(p_customer_address), ''))
    returning id into v_customer_id;
  end if;

  -- Find-or-create Vehicle by registration number (case-insensitive). A
  -- match under a *different* customer is treated as an ownership transfer
  -- (used bike resold) — re-pointed at the current customer rather than
  -- blocked, since vehicle_number has no uniqueness constraint to begin
  -- with (see the table comment above).
  select id into v_vehicle_id from public.vehicles where lower(vehicle_number) = lower(btrim(p_vehicle_number));
  if v_vehicle_id is null then
    insert into public.vehicles (customer_id, vehicle_number, vehicle_model, latest_odometer_reading)
    values (v_customer_id, btrim(p_vehicle_number), btrim(p_vehicle_model), p_odometer_reading)
    returning id into v_vehicle_id;
  else
    update public.vehicles
      set customer_id = v_customer_id,
          vehicle_model = btrim(p_vehicle_model),
          latest_odometer_reading = p_odometer_reading
      where id = v_vehicle_id;
  end if;

  insert into public.service_jobs
    (job_number, customer_id, vehicle_id, odometer_reading, status, complaint_notes, mechanic_notes,
     expected_delivery_at, gst_applicable, gst_amount, discount_applicable, discount_amount, created_by)
  values
    (public.next_service_job_number(), v_customer_id, v_vehicle_id, p_odometer_reading, 'DRAFT',
     nullif(btrim(coalesce(p_complaint_notes, '')), ''), nullif(btrim(coalesce(p_mechanic_notes, '')), ''),
     p_expected_delivery_at, coalesce(p_gst_applicable, false), coalesce(p_gst_amount, 0),
     coalesce(p_discount_applicable, false), coalesce(p_discount_amount, 0), auth.uid())
  returning id into v_job_id;

  perform public.replace_service_job_lines(v_job_id, p_lines, p_usage);
  perform public.recompute_service_job_totals(v_job_id);

  insert into public.service_job_events (service_job_id, event_type, detail, created_by)
  values (v_job_id, 'JOB_CREATED', 'Service Job created', auth.uid());

  return v_job_id;
end;
$$;

grant execute on function public.create_service_job(
  text, text, text, text, text, integer, text, text, timestamptz, boolean, numeric, boolean, numeric, jsonb, jsonb
) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. replace_service_job_lines() — shared helper: deletes and reinserts
--     every service_job_lines/service_inventory_usage row for a job. Used by
--     both create_service_job() (empty starting state) and
--     update_service_job() below (full-replace edit — no per-line edit
--     history is needed, scope doc doesn't ask for one). NOT exposed to
--     clients directly — internal helper only, called from SECURITY DEFINER
--     callers.
-- ---------------------------------------------------------------------------

create or replace function public.replace_service_job_lines(
  p_job_id uuid,
  p_lines jsonb,
  p_usage jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line jsonb;
  v_usage jsonb;
  v_position integer := 0;
  v_line_type text;
  v_description text;
  v_quantity integer;
  v_rate numeric;
  v_package_id uuid;
  v_specific_id uuid;
  v_item_id uuid;
  v_item_name text;
  v_item_price numeric;
  v_qty_used integer;
begin
  delete from public.service_job_lines where service_job_id = p_job_id;
  delete from public.service_inventory_usage where service_job_id = p_job_id;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    v_position := v_position + 1;
    v_line_type := v_line ->> 'line_type';
    v_quantity := coalesce((v_line ->> 'quantity')::integer, 1);
    v_package_id := null;
    v_specific_id := null;

    if v_line_type = 'PACKAGE' then
      v_package_id := (v_line ->> 'general_service_package_id')::uuid;
      select name, service_charge into v_description, v_rate
        from public.general_service_packages where id = v_package_id;
      if v_description is null then
        raise exception 'General Service Package % not found', v_package_id using errcode = 'P0002';
      end if;
      -- Rate is overridable per job (scope doc §9) — an explicit rate wins.
      v_rate := coalesce((v_line ->> 'rate')::numeric, v_rate);

    elsif v_line_type = 'SPECIFIC' then
      v_specific_id := (v_line ->> 'specific_service_id')::uuid;
      select name, default_charge into v_description, v_rate
        from public.specific_services where id = v_specific_id;
      if v_description is null then
        raise exception 'Specific Service % not found', v_specific_id using errcode = 'P0002';
      end if;
      v_rate := coalesce((v_line ->> 'rate')::numeric, v_rate, 0);

    elsif v_line_type = 'CUSTOM' then
      v_description := nullif(btrim(coalesce(v_line ->> 'description', '')), '');
      if v_description is null then
        raise exception 'A description is required for a custom service line' using errcode = '22023';
      end if;
      v_rate := (v_line ->> 'rate')::numeric;
      if v_rate is null then
        raise exception 'A rate is required for a custom service line' using errcode = '22023';
      end if;

    else
      raise exception 'Unknown service line type %', v_line_type using errcode = '22023';
    end if;

    if v_quantity <= 0 then
      raise exception 'Quantity must be greater than zero' using errcode = '22023';
    end if;
    if v_rate < 0 then
      raise exception 'Rate cannot be negative' using errcode = '22023';
    end if;

    insert into public.service_job_lines
      (service_job_id, position, line_type, general_service_package_id, specific_service_id, description, quantity, rate)
    values
      (p_job_id, v_position, v_line_type, v_package_id, v_specific_id, v_description, v_quantity, v_rate);
  end loop;

  for v_usage in select * from jsonb_array_elements(coalesce(p_usage, '[]'::jsonb))
  loop
    v_item_id := (v_usage ->> 'inventory_item_id')::uuid;
    v_qty_used := (v_usage ->> 'quantity_used')::integer;

    if v_qty_used is null or v_qty_used <= 0 then
      raise exception 'Quantity used must be greater than zero' using errcode = '22023';
    end if;

    select product_name, selling_price into v_item_name, v_item_price
      from public.inventory_items where id = v_item_id and is_active;
    if v_item_name is null then
      raise exception 'Inventory item % not found or inactive', v_item_id using errcode = 'P0002';
    end if;

    -- Deliberately NOT calling adjust_stock() here (scope doc §6) — this is
    -- pure data entry while the job is DRAFT/IN_PROGRESS. Deduction happens
    -- exactly once, at completion (see complete_service_job() below).
    insert into public.service_inventory_usage
      (service_job_id, inventory_item_id, item_name_snapshot, quantity_used, unit_price_snapshot)
    values
      (p_job_id, v_item_id, v_item_name, v_qty_used, v_item_price);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. recompute_service_job_totals() — internal helper, recomputes and
--     stores subtotal/inventory_total/grand_total from the current lines.
--     Pre-completion this is a live working total; complete_service_job()
--     calls it again as part of finalizing, so it's never stale at COMPLETED.
-- ---------------------------------------------------------------------------

create or replace function public.recompute_service_job_totals(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subtotal numeric;
  v_inventory_total numeric;
  v_gst numeric;
  v_discount numeric;
begin
  select coalesce(sum(amount), 0) into v_subtotal from public.service_job_lines where service_job_id = p_job_id;
  select coalesce(sum(line_total), 0) into v_inventory_total from public.service_inventory_usage where service_job_id = p_job_id;
  select gst_amount, discount_amount into v_gst, v_discount from public.service_jobs where id = p_job_id;

  update public.service_jobs
    set subtotal = v_subtotal,
        inventory_total = v_inventory_total,
        grand_total = v_subtotal + v_inventory_total + coalesce(v_gst, 0) - coalesce(v_discount, 0)
    where id = p_job_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. update_service_job() — edits a job while it's still DRAFT/IN_PROGRESS
--     (scope doc §6 note — immutable past that, mirrors Sales). Full-replace
--     on lines/usage, same customer/vehicle find-or-create as create.
-- ---------------------------------------------------------------------------

create or replace function public.update_service_job(
  p_service_job_id uuid,
  p_customer_name text,
  p_customer_mobile text,
  p_customer_address text,
  p_vehicle_number text,
  p_vehicle_model text,
  p_odometer_reading integer,
  p_complaint_notes text,
  p_mechanic_notes text,
  p_expected_delivery_at timestamptz,
  p_gst_applicable boolean,
  p_gst_amount numeric,
  p_discount_applicable boolean,
  p_discount_amount numeric,
  p_lines jsonb,
  p_usage jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_status text;
  v_customer_id uuid;
  v_vehicle_id uuid;
begin
  v_role := (auth.jwt() -> 'user_metadata' ->> 'role');
  if v_role is distinct from 'admin' then
    raise exception 'Only Administrators can edit Service Jobs' using errcode = '42501';
  end if;

  select status into v_status from public.service_jobs where id = p_service_job_id for update;
  if not found then
    raise exception 'Service Job % not found', p_service_job_id using errcode = 'P0002';
  end if;
  if v_status not in ('DRAFT', 'IN_PROGRESS') then
    raise exception 'A Service Job can only be edited while Draft or In Progress' using errcode = '22023';
  end if;

  if p_customer_mobile is null or btrim(p_customer_mobile) = '' then
    raise exception 'Customer mobile number is required' using errcode = '22023';
  end if;
  if p_vehicle_number is null or btrim(p_vehicle_number) = '' then
    raise exception 'Vehicle number is required' using errcode = '22023';
  end if;
  if p_odometer_reading is null or p_odometer_reading < 0 then
    raise exception 'A valid odometer reading is required' using errcode = '22023';
  end if;

  select id into v_customer_id from public.customers where mobile_number = btrim(p_customer_mobile);
  if v_customer_id is null then
    insert into public.customers (name, mobile_number, address)
    values (btrim(p_customer_name), btrim(p_customer_mobile), nullif(btrim(p_customer_address), ''))
    returning id into v_customer_id;
  end if;

  select id into v_vehicle_id from public.vehicles where lower(vehicle_number) = lower(btrim(p_vehicle_number));
  if v_vehicle_id is null then
    insert into public.vehicles (customer_id, vehicle_number, vehicle_model, latest_odometer_reading)
    values (v_customer_id, btrim(p_vehicle_number), btrim(p_vehicle_model), p_odometer_reading)
    returning id into v_vehicle_id;
  else
    update public.vehicles
      set customer_id = v_customer_id,
          vehicle_model = btrim(p_vehicle_model),
          latest_odometer_reading = p_odometer_reading
      where id = v_vehicle_id;
  end if;

  update public.service_jobs
    set customer_id = v_customer_id,
        vehicle_id = v_vehicle_id,
        odometer_reading = p_odometer_reading,
        complaint_notes = nullif(btrim(coalesce(p_complaint_notes, '')), ''),
        mechanic_notes = nullif(btrim(coalesce(p_mechanic_notes, '')), ''),
        expected_delivery_at = p_expected_delivery_at,
        gst_applicable = coalesce(p_gst_applicable, false),
        gst_amount = coalesce(p_gst_amount, 0),
        discount_applicable = coalesce(p_discount_applicable, false),
        discount_amount = coalesce(p_discount_amount, 0)
    where id = p_service_job_id;

  perform public.replace_service_job_lines(p_service_job_id, p_lines, p_usage);
  perform public.recompute_service_job_totals(p_service_job_id);
end;
$$;

grant execute on function public.update_service_job(
  uuid, text, text, text, text, text, integer, text, text, timestamptz, boolean, numeric, boolean, numeric, jsonb, jsonb
) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. update_service_job_status() — every transition EXCEPT the one into
--     COMPLETED (that's complete_service_job(), §14 below, since it also has
--     to deduct stock and generate an invoice). Enforces the transition
--     table from scope doc §5: forward-only, CANCELLED reachable from any
--     pre-COMPLETED state, both COMPLETED and CANCELLED are terminal.
-- ---------------------------------------------------------------------------

create or replace function public.update_service_job_status(
  p_service_job_id uuid,
  p_new_status text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_current text;
  v_valid boolean := false;
begin
  v_role := (auth.jwt() -> 'user_metadata' ->> 'role');
  if v_role is distinct from 'admin' then
    raise exception 'Only Administrators can change a Service Job''s status' using errcode = '42501';
  end if;

  if p_new_status = 'COMPLETED' then
    raise exception 'Use complete_service_job() to finalize a job' using errcode = '22023';
  end if;
  if p_new_status not in ('DRAFT', 'IN_PROGRESS', 'READY_FOR_DELIVERY', 'CANCELLED') then
    raise exception 'Unknown status %', p_new_status using errcode = '22023';
  end if;

  select status into v_current from public.service_jobs where id = p_service_job_id for update;
  if not found then
    raise exception 'Service Job % not found', p_service_job_id using errcode = 'P0002';
  end if;

  if v_current = p_new_status then
    v_valid := true; -- no-op, tolerated
  elsif p_new_status = 'CANCELLED' then
    v_valid := v_current in ('DRAFT', 'IN_PROGRESS', 'READY_FOR_DELIVERY');
  elsif v_current = 'DRAFT' and p_new_status = 'IN_PROGRESS' then
    v_valid := true;
  elsif v_current = 'IN_PROGRESS' and p_new_status = 'READY_FOR_DELIVERY' then
    v_valid := true;
  end if;

  if not v_valid then
    raise exception 'Cannot move a Service Job from % to %', v_current, p_new_status using errcode = '22023';
  end if;

  update public.service_jobs set status = p_new_status where id = p_service_job_id;

  insert into public.service_job_events (service_job_id, event_type, detail, created_by)
  values (
    p_service_job_id,
    'STATUS_CHANGED',
    v_current || ' → ' || p_new_status || coalesce(' (' || nullif(btrim(p_note), '') || ')', ''),
    auth.uid()
  );
end;
$$;

grant execute on function public.update_service_job_status(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 14. complete_service_job() — the ONLY path into COMPLETED (scope doc §7).
--     Atomic: validates ≥1 line, deducts stock per usage row via the
--     existing adjust_stock() (SERVICE_USAGE, already admin-gated — no
--     change needed there), assigns invoice_number, computes final totals,
--     stamps completed_at, defaults payment/delivery status, logs
--     JOB_COMPLETED. A mid-way insufficient-stock failure rolls back
--     everything (same all-or-nothing shape as record_sale()).
-- ---------------------------------------------------------------------------

create or replace function public.complete_service_job(p_service_job_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_status text;
  v_line_count integer;
  v_usage record;
  v_invoice_number text;
  v_subtotal numeric;
  v_inventory_total numeric;
  v_gst numeric;
  v_discount numeric;
begin
  v_role := (auth.jwt() -> 'user_metadata' ->> 'role');
  if v_role is distinct from 'admin' then
    raise exception 'Only Administrators can complete a Service Job' using errcode = '42501';
  end if;

  select status into v_status from public.service_jobs where id = p_service_job_id for update;
  if not found then
    raise exception 'Service Job % not found', p_service_job_id using errcode = 'P0002';
  end if;
  if v_status not in ('IN_PROGRESS', 'READY_FOR_DELIVERY') then
    raise exception 'A Service Job can only be completed from In Progress or Ready for Delivery' using errcode = '22023';
  end if;

  select count(*) into v_line_count from public.service_job_lines where service_job_id = p_service_job_id;
  if v_line_count = 0 then
    raise exception 'A Service Job needs at least one service line before it can be completed' using errcode = '22023';
  end if;

  -- FIFO-consumes each usage row via the existing shared stock path — the
  -- SAME function Purchases/Sales already use, reason SERVICE_USAGE
  -- (already a valid enum value, already admin-gated). Any insufficient-
  -- stock raise here aborts this entire function (job stays exactly as it
  -- was), same guarantee record_sale() gives Sales.
  for v_usage in
    select id, inventory_item_id, quantity_used
      from public.service_inventory_usage
      where service_job_id = p_service_job_id and not stock_deducted
      for update
  loop
    perform public.adjust_stock(v_usage.inventory_item_id, -v_usage.quantity_used, 'SERVICE_USAGE', 'service', null);
    update public.service_inventory_usage set stock_deducted = true where id = v_usage.id;
  end loop;

  select coalesce(sum(amount), 0) into v_subtotal from public.service_job_lines where service_job_id = p_service_job_id;
  select coalesce(sum(line_total), 0) into v_inventory_total from public.service_inventory_usage where service_job_id = p_service_job_id;
  select gst_amount, discount_amount into v_gst, v_discount from public.service_jobs where id = p_service_job_id;

  v_invoice_number := public.next_service_invoice_number();

  update public.service_jobs
    set status = 'COMPLETED',
        invoice_number = v_invoice_number,
        completed_at = now(),
        payment_status = 'PENDING',
        delivery_status = 'WAITING',
        subtotal = v_subtotal,
        inventory_total = v_inventory_total,
        grand_total = v_subtotal + v_inventory_total + coalesce(v_gst, 0) - coalesce(v_discount, 0)
    where id = p_service_job_id;

  insert into public.service_job_events (service_job_id, event_type, detail, created_by)
  values (p_service_job_id, 'JOB_COMPLETED', 'Invoice ' || v_invoice_number || ' generated', auth.uid());

  return v_invoice_number;
end;
$$;

grant execute on function public.complete_service_job(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 15. update_service_payment_status() / update_service_delivery_status()
--     (scope doc §11) — both only meaningful once COMPLETED.
-- ---------------------------------------------------------------------------

create or replace function public.update_service_payment_status(
  p_service_job_id uuid,
  p_payment_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_status text;
begin
  v_role := (auth.jwt() -> 'user_metadata' ->> 'role');
  if v_role is distinct from 'admin' then
    raise exception 'Only Administrators can update payment status' using errcode = '42501';
  end if;
  if p_payment_status not in ('PENDING', 'PARTIAL', 'PAID', 'FREE_SERVICE') then
    raise exception 'Unknown payment status %', p_payment_status using errcode = '22023';
  end if;

  select status into v_status from public.service_jobs where id = p_service_job_id for update;
  if not found then
    raise exception 'Service Job % not found', p_service_job_id using errcode = 'P0002';
  end if;
  if v_status <> 'COMPLETED' then
    raise exception 'Payment status can only be set on a Completed Service Job' using errcode = '22023';
  end if;

  update public.service_jobs set payment_status = p_payment_status where id = p_service_job_id;

  insert into public.service_job_events (service_job_id, event_type, detail, created_by)
  values (p_service_job_id, 'PAYMENT_STATUS_CHANGED', p_payment_status, auth.uid());
end;
$$;

grant execute on function public.update_service_payment_status(uuid, text) to authenticated;

create or replace function public.update_service_delivery_status(
  p_service_job_id uuid,
  p_delivery_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_status text;
begin
  v_role := (auth.jwt() -> 'user_metadata' ->> 'role');
  if v_role is distinct from 'admin' then
    raise exception 'Only Administrators can update delivery status' using errcode = '42501';
  end if;
  if p_delivery_status not in ('WAITING', 'READY_FOR_PICKUP', 'DELIVERED') then
    raise exception 'Unknown delivery status %', p_delivery_status using errcode = '22023';
  end if;

  select status into v_status from public.service_jobs where id = p_service_job_id for update;
  if not found then
    raise exception 'Service Job % not found', p_service_job_id using errcode = 'P0002';
  end if;
  if v_status <> 'COMPLETED' then
    raise exception 'Delivery status can only be set on a Completed Service Job' using errcode = '22023';
  end if;

  update public.service_jobs
    set delivery_status = p_delivery_status,
        delivered_at = case when p_delivery_status = 'DELIVERED' then now() else delivered_at end
    where id = p_service_job_id;

  insert into public.service_job_events (service_job_id, event_type, detail, created_by)
  values (p_service_job_id, 'DELIVERY_STATUS_CHANGED', p_delivery_status, auth.uid());
end;
$$;

grant execute on function public.update_service_delivery_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 16. Row Level Security — Administrator-only throughout (scope doc §1/§25),
--     unlike Sales' shared admin+sales_person access. Tables mutated only
--     through the SECURITY DEFINER functions above (service_jobs,
--     service_job_lines, service_inventory_usage, service_job_events) get a
--     SELECT-only policy — no insert/update/delete policy at all, same
--     immutable-audit-trail pattern as purchase_entries/sale_items.
-- ---------------------------------------------------------------------------

alter table public.vehicles enable row level security;
alter table public.general_service_packages enable row level security;
alter table public.specific_services enable row level security;
alter table public.service_jobs enable row level security;
alter table public.service_job_lines enable row level security;
alter table public.service_inventory_usage enable row level security;
alter table public.service_job_events enable row level security;
alter table public.service_job_images enable row level security;

create policy "vehicles_admin_select" on public.vehicles
  for select using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

-- Catalog: admin-only read too (scope doc §1 — unlike Inventory's
-- categories/brands, no other module needs to read this).
create policy "general_service_packages_admin_select" on public.general_service_packages
  for select using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');
create policy "general_service_packages_admin_insert" on public.general_service_packages
  for insert with check ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');
create policy "general_service_packages_admin_update" on public.general_service_packages
  for update using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

create policy "specific_services_admin_select" on public.specific_services
  for select using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');
create policy "specific_services_admin_insert" on public.specific_services
  for insert with check ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');
create policy "specific_services_admin_update" on public.specific_services
  for update using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

create policy "service_jobs_admin_select" on public.service_jobs
  for select using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');
create policy "service_job_lines_admin_select" on public.service_job_lines
  for select using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');
create policy "service_inventory_usage_admin_select" on public.service_inventory_usage
  for select using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');
create policy "service_job_events_admin_select" on public.service_job_events
  for select using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

-- Images: direct table access (no dedicated RPC — low-stakes, no business
-- rule beyond "the job must exist and you must be admin").
create policy "service_job_images_admin_select" on public.service_job_images
  for select using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');
create policy "service_job_images_admin_insert" on public.service_job_images
  for insert with check ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');
create policy "service_job_images_admin_delete" on public.service_job_images
  for delete using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');
