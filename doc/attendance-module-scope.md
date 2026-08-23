# Attendance Management — Scope

Confirmed 2026-08-20. A **standalone** staff-attendance module inside the
Twinspark GMS app: employees, daily marking, working hours, reports. It is
not an HR system and never becomes one.

## 0. The defining constraint — independence

Attendance shares exactly three things with the rest of the application:
authentication (`requireAdmin()`), the app shell/layout, and the design
system. Nothing else.

- Its tables reference no existing table — not `sales`, `service_jobs`,
  `inventory_items`, `purchase_entries`, `online_orders`, `customers`, and
  not even `profiles` or `auth.users`.
- `services/attendance/*` imports nothing from `services/{sales,service,
  inventory,purchases,online-orders,users,payments,reports,dashboard}`.
- Nothing outside the module imports it, reads its tables, or writes them.
- Its reports live at `/attendance/reports`, deliberately **not** as a card
  on the `/reports` grid.

Attendance keeps its **own employee roster** rather than reusing `profiles`.
The people whose attendance is marked are not the same set as the people who
can log in — a service person who never touches the app still needs marking —
and coupling them would mean an HR change silently granting or revoking
application access.

## 1. Confirmed decisions

| Decision | Choice |
| --- | --- |
| Sidebar | **One** nav entry (`/attendance`). Daily Attendance / Employees / Reports are child routes behind a tab bar, so `resolveActiveHref()` keeps the single item lit for all of them. |
| Access | Admin-only — new `"attendance"` ModuleKey. Sales Person and Mechanic never see it, and `requireAdmin()` blocks a typed URL. |
| Daily editing | **Mark by exception.** A normal day is "everyone worked the shop's hours", so that case is one click (*Mark All Full Day*, which auto-fills the times) and the admin's remaining effort is proportional to the number of exceptions, not to headcount. Per-row status is a one-click segmented control, not a dropdown. One **Save Changes** button commits every edited row in a single round trip. |
| Shop hours | Editable on the toolbar, remembered per browser in `localStorage`. It only pre-fills time inputs and is never stored as attendance data, so it doesn't justify a settings table — and it sits on screen rather than hidden in settings, so auto-filled values are never a surprise. Half days meet at the computed midpoint of the shop's own day (09:00–20:00 splits at 14:30), so no third time needs configuring. |
| Bulk fill scope | *Mark All Full Day* fills only rows still **unmarked** — mark the absences first and they survive. The button label counts what it will actually touch. |
| Copy Yesterday | Brings forward the previous day's statuses and times for anyone who has a record; people without one are left untouched rather than guessed at. Loads as an unsaved draft for review, never writes directly. |
| Time storage | `date` + plain `time` columns in IST wall clock. These are readings off the shop clock, not instants; storing them as `timestamptz` would mean converting on every read/write just to get back the number that was typed. |
| Working hours | A **stored generated column**, so it is physically impossible to store a value that disagrees with the times (Rules 2 and 7). Same technique as `inventory_items.stock_status`. |
| Overnight shifts | Out of scope — check-out must be strictly later than check-in. |
| Delete | There is none. Employees are deactivated (Rule 6); the table has no DELETE policy and the FK is `on delete restrict`. |
| Write access | The plain RLS-scoped client, like Inventory/Purchases — the service-role client exists for `auth.admin.*`, which nothing here touches. |
| Public read | None at all. Unlike `payment_qr_configs`, no `anon` policy exists — staff attendance is not public data. |
| Employee IDs | Issued by the database from a sequence — "001", "002", "003" — never typed by the admin and never editable afterwards. A sequence rather than `max()+1` in app code, because two admins adding staff at the same moment would otherwise be handed the same number. |
| "Other Staff" | Requires a free-text description of what the person actually does ("Watchman", "Accountant"). Mandatory for that role and forbidden for the other two, both enforced by CHECK constraints, so switching a role can never leave a stale job title behind. The description is what shows in every Role column — a table listing four people as "Other Staff" tells the owner nothing. |

## 2. Data model — `supabase/migrations/0031_attendance_module.sql`

```
attendance_employees
  id, employee_code (auto "001"/"002", unique, case-insensitive), name, role,
  other_role_description (required iff role = OTHER_STAFF),
  mobile (optional), joining_date, is_active, created_at, updated_at

attendance_records
  id, employee_id -> attendance_employees (on delete restrict),
  attendance_date, status, check_in, check_out,
  working_minutes  -- GENERATED ALWAYS ... STORED
  created_at, updated_at
```

Enums `attendance_role` (SALES_PERSON / SERVICE_PERSON / OTHER_STAFF) and
`attendance_status` (FULL_DAY / FIRST_HALF / SECOND_HALF / ABSENT).
`attendance_role` is deliberately separate from `public.user_role`: one is
about who can log in, the other about what a person does on the shop floor.

RLS: admin-only on both tables, gated on
`auth.jwt() -> 'user_metadata' ->> 'role' = 'admin'`, the same check every
other Admin-owned table in this project uses.

**Apply by hand in the Supabase SQL editor**, like every migration here.

## 3. Business rules and where each is enforced

| Rule | Database | Server action | UI |
| --- | --- | --- | --- |
| 1. One record per employee per day | `unique (employee_id, attendance_date)` | upsert on that constraint | — |
| 2. Working hours calculated, never entered | generated column | field absent from the Zod schema | read-only cell |
| 3. Check-out later than check-in | CHECK constraint | `superRefine` | inline error, Save blocked |
| 4. Absent ⇒ no times | CHECK constraint | `superRefine` + forced to null | inputs cleared and disabled |
| 5. Inactive employees excluded from new daily lists | — | query filters `is_active` | — |
| 6. History survives deactivation | `on delete restrict`, no DELETE policy | reports query records, not the roster | deactivate-only, no delete button |
| 7. Editing times recalculates hours | generated column recomputes on UPDATE | — | live preview while typing |

Equal check-in/check-out times are rejected too: a zero-minute working day is
a mis-entry, not a fact.

Employee codes come from `public.next_attendance_employee_code()` rather than
a bare `lpad(nextval(...), 3, '0')` default. `lpad()` **truncates** when the
input is longer than the pad width, so employee 1000 would have come out as
"100" and silently collided with employee 100 — caught in testing. The
function pads only while the number is short and lets it widen after.

"Not marked" is a distinct state from "Absent". An active employee with no
record yet counts towards neither Present nor Absent in the daily summary —
otherwise an untouched screen would read as "everyone missing".

Average working hours divides by **days worked**, not days recorded, so
absences don't drag the figure down.

## 4. Files

```
supabase/migrations/0031_attendance_module.sql
services/attendance/{schemas,working-hours,summary,types,ist-today,
                     employees,records,index}.ts  (+ 3 test files)
app/(app)/attendance/{layout,page,actions}.tsx
app/(app)/attendance/employees/{page}.tsx, employees/[id]/{page}.tsx
app/(app)/attendance/reports/{page}.tsx           (+ loading.tsx each)
components/attendance/*.tsx                        (+ 1 test file)
```

Three existing files modified, by addition only: `lib/auth/permissions.ts`
(+1 ModuleKey), `components/layout/nav-items.ts` (+1 nav entry),
`types/database.types.ts` (+2 tables, +2 enums).

## 5. Out of scope

Payroll, salary, leave management, overtime, biometric/GPS/face recognition,
employee performance tracking, overnight shifts, and self-service check-in by
staff. The schema stays extensible — a `leave_type` column or a `shifts`
table could be added later without touching what's built here — but none of
it is implemented, and this module should not grow into an HR system.
