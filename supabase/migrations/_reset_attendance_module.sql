-- ONE-OFF CLEANUP — not part of the numbered migration sequence.
--
-- Run this only if applying 0031_attendance_module.sql failed partway and
-- left some of its objects behind (typically: "type attendance_role already
-- exists"). Postgres has no `create type if not exists`, and a migration
-- that stops halfway leaves whatever it managed to create, so a retry hits
-- the leftovers rather than starting clean.
--
-- After running this, run 0031_attendance_module.sql again from the top.
--
-- SAFETY: every object named here belongs solely to the Attendance module.
-- Nothing else in the application reads or writes them, so this cannot
-- affect Inventory, Purchases, Sales, Service, Billing, Customers, Online
-- Orders, stock, or any existing report.
--
-- DESTRUCTIVE: this drops attendance data along with the tables. That is
-- the intended behaviour while first installing the module (there is
-- nothing to lose yet). Do NOT run it once the garage has started marking
-- real attendance — check first with the query in §1 below.

-- ---------------------------------------------------------------------------
-- 1. Look before you leap — what exists, and does it hold anything?
--    Run this on its own first. If either count is above zero, STOP: you
--    have real attendance data and should not run section 2.
-- ---------------------------------------------------------------------------

select
  (select count(*) from pg_tables where schemaname = 'public' and tablename = 'attendance_employees') as employees_table_exists,
  (select count(*) from pg_tables where schemaname = 'public' and tablename = 'attendance_records')   as records_table_exists,
  (select count(*) from pg_type   where typname   like 'attendance%')                                 as attendance_types;

-- ---------------------------------------------------------------------------
-- 2. Teardown. Dropped in reverse dependency order; `cascade` takes the
--    indexes, triggers, and RLS policies attached to each table with it.
-- ---------------------------------------------------------------------------

drop table    if exists public.attendance_records            cascade;
drop table    if exists public.attendance_employees          cascade;
drop function if exists public.next_attendance_employee_code() cascade;
drop sequence if exists public.attendance_employee_code_seq  cascade;
drop type     if exists public.attendance_status             cascade;
drop type     if exists public.attendance_role               cascade;

-- ---------------------------------------------------------------------------
-- 3. Confirm the slate is clean — every count below should read 0.
-- ---------------------------------------------------------------------------

select
  (select count(*) from pg_tables    where schemaname = 'public' and tablename like 'attendance%') as tables_left,
  (select count(*) from pg_type      where typname     like 'attendance%')                          as types_left,
  (select count(*) from pg_sequences where sequencename like 'attendance%')                         as sequences_left,
  (select count(*) from pg_proc      where proname      like '%attendance_employee_code%')          as functions_left;
