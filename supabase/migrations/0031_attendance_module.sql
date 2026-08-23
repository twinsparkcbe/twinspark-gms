-- Attendance Management — a deliberately STANDALONE module
-- (doc/attendance-module-scope.md, confirmed 2026-08-20).
--
-- IMPORTANT — independence is the defining constraint of this migration.
-- Nothing here references any existing business table (inventory_items,
-- sales, service_jobs, purchase_entries, online_orders, customers) or even
-- auth.users/profiles. Attendance keeps its OWN employee roster on purpose:
-- the garage's staff list for attendance is not the same set as the app's
-- login accounts (a service person who never logs in still needs marking),
-- and coupling the two would mean an HR change silently altering who can
-- sign in. Nothing in the existing app reads or writes these tables, and
-- these tables read nothing from the existing app. The only thing shared is
-- authentication — the RLS policies below reuse the same admin JWT check
-- every other Admin-owned table in this project uses.
--
-- Apply by hand in the Supabase SQL editor, same as every migration in this
-- folder (supabase/README.md).

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------

-- Deliberately NOT public.user_role. That enum is about app login roles
-- (admin/sales_person/mechanic); this one is about what a person does on the
-- shop floor. They look similar today and would drift the moment either side
-- changes — e.g. adding a "manager" login role must not add an attendance
-- category, and vice versa.
create type public.attendance_role as enum (
  'SALES_PERSON',
  'SERVICE_PERSON',
  'OTHER_STAFF'
);

create type public.attendance_status as enum (
  'FULL_DAY',
  'FIRST_HALF',
  'SECOND_HALF',
  'ABSENT'
);

-- ---------------------------------------------------------------------------
-- 2. Employees (attendance-only roster)
-- ---------------------------------------------------------------------------

-- Employee IDs are issued by the database, not typed by the admin: "001",
-- "002", "003"... A sequence rather than max()+1 in app code, because two
-- admins adding staff at the same moment would otherwise be handed the same
-- number. Past 999 it simply widens to "1000" — no wraparound, no collision.
create sequence public.attendance_employee_code_seq as integer start 1;

-- Why a function and not a bare `lpad(nextval(...)::text, 3, '0')` default:
-- lpad() TRUNCATES when the input is longer than the pad width, so employee
-- 1000 would come out as "100" — silently colliding with employee 100. Pad
-- only while the number is short, then let it widen naturally.
create or replace function public.next_attendance_employee_code()
returns text
language plpgsql
volatile
as $$
declare
  v bigint := nextval('public.attendance_employee_code_seq');
begin
  return case when v < 1000 then lpad(v::text, 3, '0') else v::text end;
end;
$$;

create table public.attendance_employees (
  id            uuid primary key default gen_random_uuid(),
  employee_code text not null default public.next_attendance_employee_code(),
  name          text not null,
  role          public.attendance_role not null,
  -- Who an "Other Staff" member actually is — "Watchman", "Accountant",
  -- "Cleaner". Required for that role and forbidden for the other two, both
  -- enforced below: a Sales Person carrying a stale free-text job title is
  -- exactly the kind of contradiction that makes a roster untrustworthy.
  other_role_description text,
  mobile        text,
  joining_date  date not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint attendance_employees_other_staff_is_described
    check (role <> 'OTHER_STAFF' or (other_role_description is not null and btrim(other_role_description) <> '')),

  constraint attendance_employees_description_only_for_other_staff
    check (role = 'OTHER_STAFF' or other_role_description is null)
);

-- Ties the sequence's lifecycle to the column, so dropping the table cleans
-- it up too rather than leaving an orphan sequence behind.
alter sequence public.attendance_employee_code_seq
  owned by public.attendance_employees.employee_code;

-- Inserting through the RLS-scoped client evaluates the column default as
-- the `authenticated` role, which needs USAGE on the sequence to call
-- nextval(). Granted explicitly rather than relying on Supabase's default
-- privileges — without this, every "Add Employee" fails with a permission
-- error on a table that otherwise looks correctly configured.
grant usage, select on sequence public.attendance_employee_code_seq to authenticated;
grant execute on function public.next_attendance_employee_code() to authenticated;

-- Case-insensitive uniqueness: "EMP01" and "emp01" are the same employee
-- code to a human, and a roster containing both is a data-entry accident,
-- not a feature.
create unique index attendance_employees_code_unique
  on public.attendance_employees (lower(employee_code));

-- Covers the Daily Attendance query, which is always "active employees,
-- ordered by name".
create index attendance_employees_active_name_idx
  on public.attendance_employees (is_active, name);

-- public.set_updated_at() already exists (0020_user_roles_profiles.sql) —
-- reused here, not redefined.
create trigger attendance_employees_set_updated_at
  before update on public.attendance_employees
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Attendance records
-- ---------------------------------------------------------------------------

create table public.attendance_records (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references public.attendance_employees (id) on delete restrict,
  attendance_date date not null,
  status          public.attendance_status not null,
  -- Plain `time`, not timestamptz: these are IST wall-clock readings off the
  -- shop clock ("09:10"), not instants. Storing them as instants would mean
  -- converting on every read/write (see lib/format.ts for the pain that
  -- causes elsewhere) just to get back the number the admin typed in.
  check_in        time,
  check_out       time,
  -- Business Rules 2 + 7 — the admin never enters working hours, and any
  -- edit to check_in/check_out recalculates them automatically. A STORED
  -- GENERATED column makes it physically impossible to store a value that
  -- disagrees with the times, the same technique inventory_items.stock_status
  -- uses (0001_inventory_schema.sql). greatest(...,0) is belt and braces:
  -- the CHECK constraint below already rejects a negative span.
  working_minutes integer not null generated always as (
    case
      when check_in is null or check_out is null then 0
      else greatest(0, (extract(epoch from (check_out - check_in)) / 60)::int)
    end
  ) stored,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- Rule 1: one employee, one record, per day. In the DB rather than app
  -- code, so a double-submit or a second browser tab can't create a
  -- duplicate; the save path upserts on this constraint.
  constraint attendance_records_one_per_day
    unique (employee_id, attendance_date),

  -- Rule 4: an absent employee has no check-in/check-out.
  constraint attendance_records_absent_has_no_times
    check (status <> 'ABSENT' or (check_in is null and check_out is null)),

  -- Rule 3: check-out cannot be earlier than check-in. Equal is rejected
  -- too — a zero-minute working day is a mis-entry, not a fact. This is also
  -- what makes overnight shifts explicitly out of scope.
  constraint attendance_records_checkout_after_checkin
    check (check_in is null or check_out is null or check_out > check_in)
);

-- Daily Attendance screen: "everything for this date".
create index attendance_records_date_idx
  on public.attendance_records (attendance_date);

-- Individual employee report: "this employee, over a date range".
create index attendance_records_employee_date_idx
  on public.attendance_records (employee_id, attendance_date desc);

create trigger attendance_records_set_updated_at
  before update on public.attendance_records
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Row Level Security — Admin only, both tables
--
-- Mirrors the auth.jwt() role check used by every other Admin-owned table in
-- this project (payment_qr_configs, 0030). Written against the plain
-- RLS-scoped client, so services/attendance never needs the service-role
-- client — unlike services/users, which needs it only for auth.admin.*.
--
-- No anon policy of any kind: unlike payment_qr_configs (whose active row the
-- public /order form reads), nothing in the attendance module is ever exposed
-- to an unauthenticated visitor. Staff attendance is not public data.
-- ---------------------------------------------------------------------------

alter table public.attendance_employees enable row level security;
alter table public.attendance_records   enable row level security;

create policy "attendance_employees_admin_select" on public.attendance_employees
  for select to authenticated
  using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

create policy "attendance_employees_admin_insert" on public.attendance_employees
  for insert to authenticated
  with check ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

create policy "attendance_employees_admin_update" on public.attendance_employees
  for update to authenticated
  using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

-- No DELETE policy on attendance_employees, on purpose. Rule 6 — historical
-- attendance must survive an employee leaving — and the module offers
-- deactivate, never delete. The FK's `on delete restrict` is the second lock
-- on the same door.

create policy "attendance_records_admin_select" on public.attendance_records
  for select to authenticated
  using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

create policy "attendance_records_admin_insert" on public.attendance_records
  for insert to authenticated
  with check ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

create policy "attendance_records_admin_update" on public.attendance_records
  for update to authenticated
  using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

create policy "attendance_records_admin_delete" on public.attendance_records
  for delete to authenticated
  using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');
