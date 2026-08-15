# Customer & Vehicle Management — Feature & Use-Case List

**Status:** Confirmed and implemented (module workflow steps 1–3 complete).
Both flagged decision points were accepted as recommended: a standalone
Vehicles tab (§2c), and the Sales-Person visibility split on Customer Detail
(§3, hiding Vehicles + Service History, keeping Sales History).

**Relationship to source docs:** Implements spec §3.2 (Customer), §3.3
(Vehicle), §4.8 (Customer Management), §4.9 (Vehicle Management), and the
Customer/Vehicle Management rows of the §6 permission matrix.

**Standards carried over:** this module adds **no new tables and no new
create/edit RPCs** — `customers` and `vehicles` are already populated by the
Sales and Service modules (customers "auto-created/reused whenever a Sale or
Service is recorded against a mobile number," vehicles the same way via
Service). Every query this module needs already exists and is already
unit-tested:

- `listCustomers` — paginated, searchable directory (`services/sales/customers.ts`)
- `listSalesForCustomer` (`services/sales/sales.ts`)
- `listVehiclesForCustomer` (`services/service/vehicles.ts`)
- `listAllVehiclesForPicker`, `listServiceJobsForVehicle`,
  `listServiceJobsForCustomer`, `getLastCompletedServiceForVehicle`
  (`services/service/jobs.ts`)

This keeps the module a thin read-only composition layer, the same pattern
Dashboard used over Inventory/Purchases/Sales stats — no aggregation or
business logic gets duplicated here.

**Why this module matters (owner's view):** Right now if a customer calls
asking "when did I last get my tyres done" or "what's my bike's number
again," that answer is scattered across Sales and Service — I'd have to
search both separately. I want one place to look up a customer (or their
bike, by plate number) and see everything: contact info, every vehicle
they've registered, every sale, every service job — one screen, no
cross-referencing.

---

## 1. What's already built (reused, not rebuilt)

Covered above — directory search, per-customer sales history, per-customer
vehicle list, per-vehicle service history all already have working,
tested query functions. Nothing new needs to be added to the `customers` or
`vehicles` tables or their RPCs.

## 2. Screens & use-cases

### 2a. Customer directory (landing view)

- Table of all customers: Name, Mobile Number, Address, (optionally) vehicle
  count and last-visit date if cheap to compute — otherwise skip to avoid a
  new aggregate query (flagged below).
- Search box filtering by name or mobile number (`listCustomers` already
  supports `filters.search`), same debounce/pattern as Sales/Service
  directories.
- Pagination, same shared table component/pattern used by Sales, Service,
  Online Orders, Inventory.
- Row click → opens Customer Detail (2b).
- **No "Add Customer" button** — customers are only ever created via a Sale
  or Service Job, matching the spec's "auto-created/reused" model. Confirmed
  intentional, not a gap.

### 2b. Customer detail

- Header: Name, Mobile Number, Address, "Customer since" (created_at).
- **Vehicles section:** every vehicle registered to this customer
  (`listVehiclesForCustomer`) — Vehicle Number, Model, Latest Odometer
  Reading. Click a vehicle to see 2d (its service history) without leaving
  the page (expand-in-place or a lightweight drawer, not a full navigation).
- **Sales history:** every sale (`listSalesForCustomer`) — date, invoice
  number, items summary, grand total, link to that sale's invoice
  (`/sales/[id]/invoice`, already built).
- **Service history:** every service job across all of this customer's
  vehicles (`listServiceJobsForCustomer`) — date, job number, vehicle,
  status, grand total, link to that job's invoice
  (`services/shared/invoice.ts` already renders Service invoices).
- Empty states for a customer with no vehicles yet (Sales-only customer, no
  Service visit) and for no sales / no service history yet.

### 2c. Vehicle lookup (separate from customer directory)

**Flagged decision point.** Spec §4.9 explicitly calls out vehicle-first
lookup: *"show all past services for KA-01-XXXX"* — a mechanic on the phone
is far more likely to know the plate number than to remember which customer
it belongs to. Recommend a second tab on this page, **"Vehicles,"**
alongside "Customers":

- Searchable table of all vehicles (`listAllVehiclesForPicker` already
  fetches everything for client-side filtering, same "fetch once, filter
  locally" pattern as the Sales/Service pickers) — Vehicle Number, Model,
  Latest Odometer, owning Customer (name + mobile, linking back to 2b).
- Row click → Vehicle Detail (2d), skipping the customer altogether.

Say so if you'd rather fold this into the Customer tab only (e.g. a
top-level "search by vehicle number" box that jumps straight to the owning
customer) instead of a standalone Vehicles tab — the tab is more direct for
the stated use case but is an extra screen.

### 2d. Vehicle detail (reached from 2b or 2c)

- Header: Vehicle Number, Model, Latest Odometer Reading, owning customer
  (link back to 2b).
- Full service history for this vehicle (`listServiceJobsForVehicle`) —
  date, job number, status, odometer at that visit, grand total, invoice
  link.
- No sales history here — Sales isn't vehicle-scoped in this app (only
  Service records a vehicle_id); a customer's sales stay on the Customer
  Detail screen only.

## 3. Access & permissions

Per spec §6 permission matrix: **Customer Management** ✅ Admin, ✅ Sales
Person ("implicitly, via Sales flow"). **Vehicle Management** ✅ Admin, ❌
Sales Person ("tied to Service, which Sales Person cannot access" —
consistent with `service` already being in `SALES_PERSON_BLOCKED`,
`lib/auth/permissions.ts`).

`"customers"` is already a `ModuleKey` and is **not** in
`SALES_PERSON_BLOCKED` today, so a Sales Person hitting `/customers` already
wouldn't be redirected — this module's access gate is mostly "already
correct," but the page content needs role-awareness *within* the page:

- **Sales Person:** Customer directory ✅, Customer Detail ✅ but **Vehicles
  section and Service history section hidden** (both are Service-derived
  data they have no access to elsewhere in the app). Sales history stays
  visible. **Vehicles tab (2c) hidden entirely.**
- **Admin:** everything — both tabs, both sections on Customer Detail, full
  Vehicle Detail.

This mirrors how a Sales Person already can't see Service data anywhere
else in the app; it would be inconsistent to expose it here.

## 4. Non-goals for this pass

- **No create/edit/delete** for customers or vehicles from this module —
  they're system-of-record data owned by Sales/Service's create flows.
  Fixing a typo'd address or merging a duplicate customer (e.g. two records
  for slightly different mobile number formatting) is a real gap but out of
  scope here; flagging for a future pass if it comes up.
- **No vehicle count / last-visit-date column** on the directory table (2a)
  unless you want it — computing it live would mean an extra aggregate
  query per row (or a join) that doesn't exist yet, unlike everything else
  in this module which is pure reuse. Cheap to add later if wanted.
- **No export** (CSV/PDF customer list) — not mentioned in spec §4.8/4.9,
  and Reports module is the natural home for exports later.
- **No SMS/WhatsApp/communication actions** from this screen (e.g. "call
  customer," "send reminder") — out of scope per project rules generally.

## 5. Edge cases

- Customer with vehicles but zero sales/service yet (shouldn't really
  happen since vehicles only get created via Service, which also creates a
  service job) — but handle gracefully anyway: empty-state text, not a
  crash.
- Vehicle with only in-progress (not yet `COMPLETED`) service jobs — still
  shows in history with its current status badge, not hidden until done.
- Search with no matches (either tab) → clear empty state, not a blank
  table.
- Very long history (a multi-year repeat customer) — paginate or cap
  sales/service history lists on Customer/Vehicle Detail (recommend same
  page size as other tables, e.g. 10-20 rows with "load more" or pagination)
  rather than rendering an unbounded list.
- Two customer records that are really the same person (typo'd mobile
  number) show up as separate rows — known limitation, not solved by this
  pass (see Non-goals).

---

Confirm this list — especially the **Vehicles tab vs. folded-in vehicle
search** decision (§2c) and the **Sales-Person visibility split** on
Customer Detail (§3, hiding Vehicles + Service history but keeping Sales
history) — and I'll move to test cases next, in chat, per the module
workflow.
