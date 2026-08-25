-- Per-day wage on the Attendance module, so a date-range report can show
-- what each employee earned for the days they actually worked.
--
-- SCOPE: this produces an INDICATIVE wage figure derived from attendance. It
-- is not payroll. No deductions, advances, overtime, bonuses, PF/ESI, leave
-- encashment or payslips — all still explicitly out of scope
-- (doc/attendance-module-scope.md §5). Anyone treating this number as final
-- pay is using it for something it was not built to do.
--
-- WHY THE WAGE IS SNAPSHOTTED ONTO EVERY RECORD, not just read from the
-- employee: a wage stored only on attendance_employees means that giving
-- someone a raise in October silently rewrites what August's report says
-- they earned. Past months would stop matching what was actually paid, with
-- nothing on screen to indicate they had changed. Copying the rate onto each
-- record at save time freezes history — the same reasoning behind
-- 0012_edit_purchase_entry.sql refusing to let an edit to an older batch
-- reprice today's stock.
--
-- Confirmed with the developer 2026-08-23: snapshot-on-save, half day pays
-- exactly 50%, and hours worked never affect pay (a Full Day is a Full Day
-- whether it ran 7 hours or 10).

-- ---------------------------------------------------------------------------
-- 1. The rate, on the employee
-- ---------------------------------------------------------------------------

-- Nullable on purpose: employees added before this migration have no wage,
-- and the garage may genuinely not want one recorded for some staff. The UI
-- renders a missing wage as "—", never as zero — "no rate recorded" and
-- "owed nothing" are very different statements to put in front of an owner.
alter table public.attendance_employees
  add column if not exists daily_wage numeric(10, 2);

alter table public.attendance_employees
  drop constraint if exists attendance_employees_daily_wage_positive;

alter table public.attendance_employees
  add constraint attendance_employees_daily_wage_positive
    check (daily_wage is null or daily_wage > 0);

-- ---------------------------------------------------------------------------
-- 2. The snapshot + the derived amount, on each record
-- ---------------------------------------------------------------------------

-- The rate in force on the day this record was first saved. Written by
-- services/attendance/records.ts and deliberately preserved, never
-- refreshed, when an existing record is edited later.
alter table public.attendance_records
  add column if not exists daily_wage numeric(10, 2);

alter table public.attendance_records
  drop constraint if exists attendance_records_daily_wage_positive;

alter table public.attendance_records
  add constraint attendance_records_daily_wage_positive
    check (daily_wage is null or daily_wage > 0);

-- Generated, exactly like working_minutes: the admin can never type a salary
-- figure in, and correcting a status recalculates the amount automatically.
--
-- Null wage yields a null amount for EVERY status, including Absent. Letting
-- an unpriced absence fall through to 0 would make "we never set this
-- person's rate" indistinguishable from "this person earned nothing", and
-- the reports would quietly total a wage bill that is missing people.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'attendance_records'
       and column_name  = 'payable_amount'
  ) then
    alter table public.attendance_records
      add column payable_amount numeric(10, 2) generated always as (
        case
          when daily_wage is null then null
          when status = 'FULL_DAY' then daily_wage
          when status in ('FIRST_HALF', 'SECOND_HALF') then round(daily_wage * 0.5, 2)
          else 0
        end
      ) stored;
  end if;
end $$;

-- Backfill: existing records predate the wage entirely, so they stay null
-- (unpriced) rather than being retro-priced at whatever rate is set later.
-- That is the honest answer — nobody knows what those days were worth.
