# Service Management — Feature & Use-Case List

**Status:** Confirmed for build (module workflow step 1) — **Revision 2**,
supersedes the single-status/mutually-exclusive-service-type design of
Revision 1. Rewritten after a real-garage-operations review; every point
below traces back to that review (referenced inline as **[R2-n]**).
**Relationship to source docs:** Implements
`Twinspark_Garage_Management_System_SPEC.md.pdf` §3.3, §3.10–§3.14,
§4.6–§4.9, §4.10 (Service Invoice half), §6, §7. The PRD describes the
happy-path data shape; this revision adds the operational workflow
(status, drafts, payment/delivery tracking) the PRD didn't model, because a
real shop can't run multiple concurrent jobs a day without it. Nothing here
removes or contradicts a PRD field — it wraps a lifecycle around the same
underlying concepts.
**Architecture — unchanged [R2-19]:** same shared `adjust_stock()` as the
only stock-mutating path, same shared invoice engine
(`services/shared/invoice.ts`, `lib/business-info.ts`), same Zod +
Server Action + service layering, same filter/table/pagination/stats-card
UI, same toast/dialog/loading/empty-state conventions, same Combobox
conventions, same soft-deactivate-never-delete convention for catalogs.
This revision extends the workflow around that architecture; it does not
replace any of it.

---

## 1. Access

**Administrator only** (spec §4.6, §6 access matrix) — unchanged. One
note worth flagging: the review below repeatedly says "service advisors
and staff" need speed. If in practice more than one person needs to run
Service day-to-day, that's a User Roles question (a new role, or Sales
Person's permissions widened) — out of scope for this doc, since the PRD
is explicit that Sales Person has zero Service access. Flagging so it
doesn't get silently baked in as "obviously fine" — say the word and it's
a one-line change to the role guard, not a redesign.

## 2. Customer & Vehicle

Unchanged from Revision 1:

- **Customer**: reuses `customers` (Sales' table) — mobile-number
  lookup/auto-fill, auto-create on no match.
- **Vehicle**: `vehicles` — `customer_id`, `vehicle_number`,
  `vehicle_model` (free text), `created_at`. Auto-suggest by registration
  number, auto-create on no match.
- **Odometer reading**: captured per Service Job (history via job
  records), `vehicles.latest_odometer_reading` denormalized for quick
  display.

## 3. Service Catalog

Full admin CRUD for **General Service Packages** and **Specific Services**
(name, price, `is_active`), under a **Service → Manage Catalog**
sub-screen — needed for clean "service type" reporting.

**Revision 3 addition — Default Inventory Items:** both a General Service
Package and a Specific Service (e.g. "Water Wash") can have one or more
inventory items linked to them at the catalog level, each with a default
quantity (e.g. "Standard Service" → 1L Engine Oil × 1, Oil Filter × 1).
When staff pick that package/service on a Service Job, its linked items
auto-populate into Parts Used (doc §4/§6) — merging into an existing line
for the same item (quantity adds) rather than creating a duplicate row.
This is a one-way auto-fill: staff can freely edit or remove the
auto-added lines afterward (same "auto-fill but overridable" convention as
everywhere else), and removing the Package/Specific Service line itself
does **not** retroactively remove parts it added — kept deliberately
simple rather than tracking provenance per line. `included_items` (the
existing free-text summary, e.g. "Oil Change, Water Wash, Standard
Inspection") is unchanged and stays purely descriptive — the new linked
items are the structured, stock-affecting counterpart to that text.

## 4. Mixed Service Jobs **[R2-1] — replaces Revision 1's either/or design**

A single Service Job now supports, all at once:

- **0 or 1** General Service Package
- **0..N** Specific Services
- **0..N** Custom Service lines (§8)

Example from the review: General Service + Chain Cleaning + Brake
Bleeding + Clutch Adjustment, all on one job. This replaces the old
`service_category` enum (`GENERAL_SERVICE` / `SPECIFIC_SERVICE`) entirely
— there's no longer a single "type" to pick, just a running list of
service lines, conceptually identical to how Sales already mixes
`PRODUCT` and `INSTALLATION` lines on one sale.

**Data model — unified `service_job_lines` table** (replaces Revision 1's
separate `selected_general_package_id` / `selected_specific_services`
columns):

- `id`, `service_job_id`, `position` (order added, same as `sale_items`).
- `line_type`: `'PACKAGE' | 'SPECIFIC' | 'CUSTOM'` (text + check
  constraint, same pattern as `sale_items.line_type` — not a Postgres
  `enum` type, so adding a line type later never needs an `ALTER TYPE`).
- `general_service_package_id` / `specific_service_id`: FK, nullable,
  populated only for `PACKAGE`/`SPECIFIC` respectively. `CUSTOM` leaves
  both null.
- `description`, `quantity`, `rate`, `amount` — see §8/§9, the unified
  line shape the review asked for.
- Historical snapshot fields (§16): `description` and `rate` are copied
  from the catalog at insert time, not looked up live.

A job with **zero** lines is valid while in `DRAFT` (§5) — staff might
save a draft before they've decided what's being done — but at least one
line is required before it can move past `IN_PROGRESS` (§9 validation).

## 5. Job Status Workflow **[R2-2]**

`service_jobs.status`, text + check constraint (same reasoning as
`line_type` above — a 5th or 6th status later shouldn't need an
`ALTER TYPE`):

`DRAFT` → `IN_PROGRESS` → `READY_FOR_DELIVERY` → `COMPLETED`
`DRAFT` / `IN_PROGRESS` / `READY_FOR_DELIVERY` → `CANCELLED`

- **`DRAFT`**: job exists, nothing committed — no stock touched, excluded
  from every report/dashboard figure (§6, §15).
- **`IN_PROGRESS`**: mechanic is actively working it. Still no stock
  deducted (§6).
- **`READY_FOR_DELIVERY`**: mechanical work is done; billing/review still
  pending. Distinct from *delivery* status (§11) — see the reconciliation
  note there, this is about work being finished, not the bike leaving the
  premises.
- **`COMPLETED`**: the finalize step (§7) — invoice generated, stock
  deducted, `completed_at` stamped. Terminal, no further status changes
  except payment/delivery sub-statuses (§10/§11).
- **`CANCELLED`**: terminal, reachable from any pre-`COMPLETED` status.
  Since stock was never deducted before `COMPLETED` (§6), cancelling
  needs **zero** stock reversal — nothing to undo.

No backward transitions (`COMPLETED`/`CANCELLED` are terminal; you can't
go `READY_FOR_DELIVERY` back to `IN_PROGRESS`) — if staff jump ahead by
mistake, that's a data-entry fix, not a workflow the UI needs to support
formally. Enforced server-side by `update_service_job_status()` (a
`SECURITY DEFINER` function validating the transition table above),
mirroring the same "one function is the only path that mutates this" rule
`adjust_stock()`/`record_sale()` already establish.

Status is shown as a colored badge in both the Service List and Service
Detail view (same badge component pattern as Purchases' status column).

## 6. Save as Draft & Deferred Inventory Deduction **[R2-3, R2-4]**

- Staff can save a Service Job at any point with `status = 'DRAFT'` and
  return to it later — same "continue editing" pattern as any other
  in-progress form, just persisted server-side instead of only in local
  form state, so it survives a page refresh or a shift change.
- **Inventory is not deducted when a `service_inventory_usage` line is
  added.** Adding/removing parts while `DRAFT` or `IN_PROGRESS` is pure
  data entry — no `adjust_stock()` call happens yet. This is the one
  deliberate divergence from Sales (which deducts immediately) — Service
  jobs run for hours, parts get swapped mid-job, and deducting early would
  mean constantly reversing/re-deducting stock for a job that isn't final
  yet.
  - *Non-blocking informational check only*: if a line's `quantity_used`
    exceeds current `available_quantity`, show a warning inline (doesn't
    block saving the draft — someone might restock before the job
    finishes) — no hard error until §7's completion step.
- **Deduction happens exactly once, atomically, at the `DRAFT`/
  `IN_PROGRESS`/`READY_FOR_DELIVERY` → `COMPLETED` transition** — see §7.
- **Cancelling a `DRAFT` or `IN_PROGRESS` job leaves stock untouched** —
  there's nothing to reverse, because nothing was ever deducted. This
  directly satisfies the review's requirement and is *simpler* than
  Sales' return/undo machinery, not more complex.
- Draft and Cancelled jobs are excluded from every Dashboard/Report figure
  (§15) and from Reports' revenue totals — only `COMPLETED` jobs count as
  real business.

## 7. Completing a Job — `complete_service_job()`

The one function that performs the `→ COMPLETED` transition, atomically
(same all-or-nothing shape as `record_sale()` — a mid-way stock failure
leaves nothing partially committed):

1. Validates at least one `service_job_lines` row exists (a job needs to
   have *done* something — mirrors Sales' "at least one product line"
   rule).
2. For every `service_inventory_usage` line, calls the **existing**
   `adjust_stock(itemId, -qty, reason='SERVICE_USAGE',
   sourceModule='service', note)` — `SERVICE_USAGE` already exists in
   `stock_movement_reason` (migration 0001) and is already admin-gated.
   **No stock migration needed.** If any line has insufficient stock, the
   whole completion aborts with that error — staff adjusts the
   quantity/item and retries; the job stays `IN_PROGRESS`/
   `READY_FOR_DELIVERY` in the meantime, nothing is lost.
3. Computes and stores totals: package/specific/custom line subtotal +
   inventory-used total + GST − Discount → Grand Total (same formula
   shape as Sales).
4. Assigns `invoice_number` via `next_service_invoice_number()` (§10 —
   only happens here, not at job creation).
5. Sets `status = 'COMPLETED'`, `completed_at = now()`,
   `payment_status = 'PENDING'`, `delivery_status = 'WAITING'` (§10/§11
   only become meaningful from this point on).
6. Logs a `JOB_COMPLETED` timeline event (§14).

## 8. Custom Service Lines **[R2-11]**

A `service_job_lines` row with `line_type = 'CUSTOM'`:
`general_service_package_id`/`specific_service_id` both null,
`description` free-text (required), `quantity`, `rate`, `amount` —
behaves identically to a `PACKAGE`/`SPECIFIC` line everywhere else (job
card, invoice, totals, timeline) once created. No catalog entry needed;
this is the escape hatch for one-off work that doesn't warrant adding a
permanent catalog item.

## 9. Unified Service Line Structure **[R2-12]**

Every `service_job_lines` row, regardless of `line_type`, has the same
four fields — replaces Revision 1's labour-charge-only shape:

- `description` — copied from the catalog name (`PACKAGE`/`SPECIFIC`) or
  typed fresh (`CUSTOM`).
- `quantity` — integer, defaults to `1` (packages/specific services are
  virtually always qty 1, but the field exists uniformly so a `CUSTOM`
  line like "2 hrs additional labour" works the same way).
- `rate` — decimal, pre-filled from the catalog's `service_charge` /
  `default_charge` (editable per job, same "auto-fill but overridable"
  convention as Sales' Tyre Fitting rate) or typed fresh for `CUSTOM`.
- `amount` — `generated always as (quantity * rate) stored` — same
  generated-column technique already used for `sale_items.line_total`,
  so it can never drift from its inputs.

Validation: `quantity > 0`, `rate >= 0`, `description` non-empty. At
least one line required before `COMPLETED` (§7).

## 10. Job Number vs. Invoice Number **[R2-10]**

Two separate identifiers, assigned at two different times:

- **`job_number`** (`SJ-000001`): assigned **immediately on first save**,
  even `DRAFT` — own sequence (`service_job_number_seq`,
  `next_service_job_number()`, same pattern as
  `next_sales_invoice_number()`). This is what staff and customers
  reference while the job is still open ("what's the status on
  SJ-000042?").
- **`invoice_number`** (`TW-J-000001`): assigned only at `COMPLETED`
  (§7) — own sequence (`service_invoice_number_seq`,
  `next_service_invoice_number()`). A cancelled or still-open job never
  gets one.

Both live directly on `service_jobs` (no separate `invoices` table),
matching how `sales.invoice_number` already sits directly on `sales`.

## 11. Payment Status & Delivery Status **[R2-7, R2-8]**

Two independent status fields on `service_jobs`, both only meaningful
from `COMPLETED` onward (locked/hidden in the UI before that — there's no
invoice to pay or deliver against yet):

- **`payment_status`**: `PENDING | PARTIAL | PAID | FREE_SERVICE`
  (text + check constraint). Defaults `PENDING` at completion.
  `FREE_SERVICE` is a manual override for warranty/goodwill jobs — the
  invoice still shows the computed Grand Total, but the job is flagged so
  Reports don't count it as collected revenue. This is a status flag, not
  a payment ledger — no partial-amount-paid tracking, no collections
  workflow; if that's needed later it's a separate confirmed addition.
- **`delivery_status`**: `WAITING | READY_FOR_PICKUP | DELIVERED`.
  Defaults `WAITING` at completion.

**Reconciling with job status's `READY_FOR_DELIVERY` (§5)** — these are
two different things despite the similar names, and worth being explicit
about since the review's wording could read as overlapping:

- `status = READY_FOR_DELIVERY` = the *mechanic's* signal — work is
  physically done, still needs review/billing before it's finalized.
- `delivery_status = READY_FOR_PICKUP` = the *front desk's* signal —
  invoice exists, bike is sitting there, customer can come collect it.

So the real sequence is: mechanic finishes → `status:
READY_FOR_DELIVERY` → advisor reviews and finalizes → `status: COMPLETED`
(`delivery_status` auto-set to `WAITING`) → front desk marks
`delivery_status: READY_FOR_PICKUP` once it's physically staged → visits
customer → `delivery_status: DELIVERED`. **Flagging this as my
interpretation, not a locked decision** — cheap to rename one of the two
if it still reads as confusing once you see it in the UI.

## 12. Expected Delivery, Completed, Delivered timestamps **[R2-9]**

- `expected_delivery_at` (timestamptz) — staff-entered estimate, settable
  any time from `DRAFT` onward, editable throughout (used for "when will
  my bike be ready" conversations).
- `completed_at` — auto-stamped by `complete_service_job()` (§7).
- `delivered_at` — auto-stamped when `delivery_status → DELIVERED`.

## 13. Customer Complaint **[R2-5]**

`service_jobs.complaint_notes` (text, multi-line) — captured before work
begins, part of the `DRAFT` intake. UI: a row of quick-tap chips for
common complaints (Engine Noise, Brake Issue, Starting Problem, Mileage
Drop, Chain Noise) that append to the text field, plus free typing for
anything else — chips are a fixed UI list, not a managed catalog (no CRUD
needed, low stakes compared to the pricing catalog in §3). Appears on the
printable Job Card (§17) and in Service History; **not** on the Invoice —
invoice stays a purely financial document, same principle as Sales'
invoice never carrying non-financial fields.

## 14. Mechanic Notes **[R2-6]**

`service_jobs.mechanic_notes` (text, multi-line) — internal only.
**Never** rendered on the Job Card or Invoice (both are customer-facing
prints); visible only in the admin Service Job detail screen. Enforced at
the view-model level (`buildJobCardView()`/`buildServiceInvoiceView()`
simply never read this field), not just a UI toggle — so there's no path
that accidentally leaks it onto a print.

## 15. Service Timeline **[R2-16]**

`service_job_events` — append-only log, populated automatically by the
server-side functions that change state (never manual staff entry, so it
costs zero extra clicks — matches §21's speed principle):

- `id`, `service_job_id`, `event_type` (text — `JOB_CREATED`,
  `STATUS_CHANGED`, `JOB_COMPLETED`, `PAYMENT_STATUS_CHANGED`,
  `DELIVERY_STATUS_CHANGED`), `detail` (text, e.g. "Draft → In Progress"),
  `created_by`, `created_at`.
- Rendered as a simple vertical timeline on the Service Job detail view.
- Deliberately logs *state transitions*, not every line-item edit —
  logging every parts-list tweak would make the timeline noisy without
  adding real audit value; the meaningful events are the ones above.

## 16. Preserve Historical Data **[R2-18]**

- Catalog rows (`general_service_packages`, `specific_services`,
  `inventory_items`) are **never hard-deleted**, only `is_active = false`
  (already the Revision 1 convention, §3).
- `service_job_lines.description`/`rate` are **copied at insert time**
  from the catalog, not computed live from the FK — identical principle
  to `sale_items.unit_selling_price` ("Copied from
  `inventory_items.selling_price` at time of sale... internal cost
  variance stays invisible here"). Editing a package's price tomorrow
  never changes what last month's completed job shows.
- Same for `service_inventory_usage` — records the item name/price at
  time of use, not a live join.

## 17. Job Card **[R2-15, spec §4.7]**

- Printable at **any status**, including `DRAFT` — a mechanic or advisor
  can print the working card before the job is finalized (review's
  explicit ask: print card ≠ generate invoice, and they're now on
  separate triggers entirely: Job Card is always available,
  Invoice only exists from `COMPLETED` onward).
- Contents: Customer + Vehicle details, Complaint (§13), the
  `service_job_lines` table (No | Description | Qty | Rate | Amount —
  this **is** the "free-form line-item table" from spec §4.7; there's no
  separate free-form table anymore, `CUSTOM` lines fill that role, §8),
  running/grand totals. **Never** includes Mechanic Notes (§14).
- Route: `/service/[id]/job-card`, same print-stylesheet/`window.print()`
  pattern as `/sales/[id]/invoice` established by Billing.

## 18. Service Invoice **[spec §4.10, §7]**

Unchanged in shape from Revision 1, generation trigger changed per §7:

- Service/Package Charges + Specific Service Charges + Custom Charges
  section (all `service_job_lines`, §9), Inventory Used section
  (itemized, never blended in), GST (optional), Discount (optional),
  Grand Total.
- **Only exists from `COMPLETED` onward** (§7/§17) — route
  `/service/[id]/invoice` renders "not yet available" (or simply isn't
  linked) for any job still `DRAFT`/`IN_PROGRESS`/`READY_FOR_DELIVERY`.
- Access: Administrator only (§1).
- Built on the same shared invoice engine as Sales
  (`ServiceInvoiceView` alongside the existing `SalesInvoiceView`).

## 19. Pending Job Detection **[R2-13]**

When a vehicle is selected on `/service/new`, a lightweight query checks
for existing `service_jobs` on that `vehicle_id` with
`status in ('DRAFT','IN_PROGRESS','READY_FOR_DELIVERY')`. If found, a
non-blocking banner appears: *"This vehicle already has an active Service
Job — SJ-000042 (In Progress)."* with a link to open it. Staff can
dismiss and continue creating a new job regardless (e.g. a second,
genuinely separate issue) — this is a heads-up, not a hard block, per
§21's "don't interrupt the workflow with unnecessary restrictions."

## 20. Search Improvements **[R2-14]**

Service List's existing filter search box (same pattern as
Inventory/Purchases/Sales) now matches against: Vehicle Number, Customer
Name, Mobile Number, Job Number (`SJ-...`), Invoice Number (`TW-J-...`)
— single unified input, not five separate fields, consistent with the
speed principle in §21.

## 21. Before & After Images **[R2-17 — optional]**

- `service_job_images`: `id`, `service_job_id`,
  `image_type` (`'BEFORE' | 'AFTER'`), `storage_path`, `created_at`.
- Reuses the **existing** Supabase Storage pattern already built for
  Inventory item images (migration `0002_inventory_images.sql`) — no new
  upload infrastructure.
- Fully optional at every status — never blocks saving a draft or
  completing a job. Useful for accident repairs/premium work, skippable
  for a routine oil change.

## 22. UX / Speed Design Philosophy **[R2-20]**

The Service Job form should feel like a fast POS screen, not a data-entry
form. Concrete implications for `/service/new` and the Service List,
building on patterns already established elsewhere in this codebase:

- **Selecting a General Service Package auto-adds its line** (§4) with
  pre-filled rate — staff only touches what's *different* for this job
  (an extra specific service, a swapped part), not everything from
  scratch.
- **Keyboard-first Comboboxes** for Customer/Vehicle/Package/Specific
  Service/Inventory Item search — same inline (non-portal) Combobox
  component already fixed for Sales/Inventory, with Tab/Enter/Arrow-key
  navigation; no mouse-only dead ends.
- **Debounced, indexed search** on `customers.mobile_number`,
  `vehicles.vehicle_number`, and the Service List's unified search (§20)
  — stays responsive as the customer/vehicle/job history grows; add DB
  indexes on these columns in the migration, same as `customers_mobile_idx`
  already established.
- **Running totals recompute live** client-side as lines are added/
  removed (mirrors Sales' `/sales/new` live total), server only
  re-validates/persists on save — no "click to recalculate" step.
- **Non-blocking validation everywhere except the two moments that
  actually protect the business**: completing a job (needs ≥1 line,
  needs sufficient stock, §7) and the required fields for a `CUSTOM`
  line/complaint text. Everything else (pending-job warning, low-stock
  hint) is advisory, never a hard stop.
- **Primary actions always visible**, not buried in a menu: Save Draft,
  Complete Job, Print Job Card, Generate/View Invoice — same prominent
  action-bar placement pattern as `/sales/new`'s submit bar.
- **Common Specific Services surfaced first** in the picker (e.g. most
  frequently used ones pinned/sorted to the top) rather than a flat
  alphabetical catalog list — cheap sort-by-usage-count, no separate
  "favorites" feature needed.

This section is design guidance carried into implementation, not new
schema — it shapes how §4/§9/§19/§20 actually get built in the UI.

## 23. Dashboard / Reports Data Contract **(revised for status filtering)**

- `getServiceStats(dateRange)` → aggregates **`status = 'COMPLETED'`
  jobs only** (§6) — `DRAFT`/`CANCELLED` never count as revenue, and a
  `FREE_SERVICE` payment status (§11) is excluded from *collected*
  revenue even though it's a completed job (flag both cuts so Reports can
  offer either view later).
- Service Report fields: date range, service type (from `line_type` +
  catalog name, §4), labour/service charges, inventory used, payment
  status, delivery status — all covered by `service_jobs` /
  `service_job_lines` / `service_inventory_usage` above.
- Stock Movement Report: `SERVICE_USAGE` rows land in `stock_movements`
  only at completion (§7), same automatic feed Sales/Purchases already
  get from `adjust_stock()` — no separate reporting logic needed.

## 24. UI/Component Reuse

Unchanged principle from Revision 1 — same Combobox, table, stats-card,
skeleton/empty-state, toast, and Server-Action-only-writes conventions as
every other module. `/service/new` is a dedicated page (not a modal),
same reasoning as `/sales/new`. Service Catalog management reuses
Inventory's Category/Brand CRUD pattern.

## 25. Access & RLS

- New tables — `vehicles`, `service_jobs`, `service_job_lines`,
  `service_inventory_usage`, `service_job_events`, `service_job_images`,
  `general_service_packages`, `specific_services` — RLS **admin-only**
  read/write (unchanged from Revision 1, matches §1).
- `adjust_stock()`: no change needed — `SERVICE_USAGE` already exists in
  the enum and is already admin-gated (§7).

## 26. Non-Goals (still out of scope)

- No warranty-claim-specific fields beyond what `payment_status =
  FREE_SERVICE` + `mechanic_notes` already cover.
- No mechanic/staff assignment or scheduling.
- No SMS/WhatsApp notifications (project instructions).
- No server-side PDF generation — browser print, same as Sales.
- No payment ledger / partial-amount tracking beyond the status flag
  (§11) — a real collections workflow is a separate future ask.

## 27. Confirmed Decisions Log

- Service Jobs mix 0–1 Package + 0..N Specific + 0..N Custom lines on one
  unified `service_job_lines` table (§4).
- Full status lifecycle: `DRAFT → IN_PROGRESS → READY_FOR_DELIVERY →
  COMPLETED`, with `CANCELLED` reachable from any pre-`COMPLETED` state
  (§5).
- Inventory deducts exactly once, atomically, at `COMPLETED` — never
  earlier, never needs reversal on cancel (§6/§7).
- `job_number` (`SJ-...`) assigned at creation; `invoice_number`
  (`TW-J-...`) assigned only at completion — two sequences (§10).
- `payment_status` and `delivery_status` are independent fields, both
  only meaningful from `COMPLETED` onward (§11).
- Job Card available at any status; Invoice only from `COMPLETED` (§17/
  §18).
- Access stays Administrator-only, unchanged from Revision 1 (§1) — flag
  raised, not changed, pending your confirmation either way.

## 21. Service-First, Billing-Later (Revision 4)

Confirmed after a real-garage-operations discussion: staff don't usually
fill in a detailed job card before the mechanic starts — the bike gets
fixed first, and only once it's done does the advisor sit down and enter
everything in one sitting (services, parts, GST/discount) and bill it
immediately. The build supports both moments without forcing either:

- **Quick Intake** (`/service/intake`, optional) — a lightweight,
  ~10-second screen: Customer, Vehicle, Odometer, optional Complaint.
  Nothing about the work itself. Creates the job via the existing
  `createServiceJob` (lines/usage both already optional) and immediately
  nudges it from `DRAFT` to `IN_PROGRESS` via `updateServiceJobStatus` —
  the bike really has been accepted, there's no meaningful Draft state
  for this path. This is the default "New Service Job" action from the
  Service list (labelled **Accept Vehicle**); "enter full details now"
  stays one click away to `/service/new` for jobs where everything is
  already known upfront (e.g. a scheduled appointment).
- **Complete & Generate Invoice** (on both `/service/new` and the Edit
  screen) — the one-shot billing flow for when the work is finished:
  save whatever's on the form (creating the job first if it doesn't
  exist), auto-transition `DRAFT → IN_PROGRESS` if needed, call
  `complete_service_job()` (deducts stock, assigns the invoice number),
  then optionally stamp a payment status picked on the same screen
  (`update_service_payment_status` only accepts `COMPLETED` jobs, so this
  fires immediately after). Ends by redirecting straight to the printable
  invoice. Client-side blocks with "Add at least one service before
  completing" if the line list is empty — mirrors `complete_service_job`'s
  own ≥1-line check without a wasted round trip.

No new tables or RPCs — `saveAndCompleteServiceJob()` and
`createServiceJobIntake()` (both in `services/service/jobs.ts`) are thin
orchestrators over functions this module already exposed (§6/§7/§11). A
failure partway through (e.g. insufficient stock at the complete step)
leaves the job saved with whatever was entered, sitting at whatever status
it reached — nothing lost, same button retried once fixed.
