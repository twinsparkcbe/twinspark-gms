# Reports — Feature & Use-Case List

**Status:** Draft — module workflow step 1, awaiting confirmation before test
cases / implementation.

**Relationship to source docs:** Implements spec §4.12 (Reports: Inventory,
Purchase, Sales, Service, Revenue, Profit, Online Orders) and the §6
permission matrix (**Administrator only — Sales Person has zero access to
any report type**, not even read-only). Adds two report types beyond the
PRD's list, both explicitly requested: **Customer Follow-Up (leads)** and
**Ageing Stock**.

**Standards carried over, with one honest exception:** unlike Dashboard and
Customer & Vehicle, Reports is **not** a purely thin composition layer.
Six of the nine reports below reuse existing, already-tested stats/list
functions directly (Inventory, Purchase, Service, Sales, Profit, Revenue all
lean on `getInventoryStats`/`listInventoryItems`, `getPurchaseStats`/
`listPurchaseEntries`, `getServiceStats`/`listServiceJobs`, `listSales`,
`getCostOfGoodsSold`). Three genuinely need new query functions because the
data isn't queryable in the shape a report needs yet: **Ageing Stock**
(nobody has ever needed "oldest unsold batch per item" before), **Customer
Follow-Up** (nobody has needed "every customer past a threshold," only
per-customer history), and **Online Orders** date-ranged stats (today's
`getOnlineOrderStats` is a fixed snapshot, not filterable by range). These
are called out per-report below so it's clear which is reuse and which is
new logic that needs its own test cases.

**Why this module matters (owner's view):** Every other module tells me
what happened when I'm already looking at it. Reports is the one place I'd
actually sit down with a cup of tea and ask "how's the shop doing" — am I
making money, what's selling, what's just sitting there, and who should I
be calling right now instead of waiting for them to walk back in.

---

## 0. Page structure

A **Reports landing page** (`/reports`) showing a card per report type
(icon, name, one-line description) — not a single page with nine tabs
crammed in, since each report has its own distinct filter set. Each card
links to its own route: `/reports/inventory`, `/reports/purchases`,
`/reports/sales`, `/reports/service`, `/reports/customer-followup`,
`/reports/ageing-stock`, `/reports/revenue`, `/reports/profit`,
`/reports/online-orders`. Same shell/filter-bar/table visual language as
every other module (style guide, existing table components).

**Access:** every one of these routes is Admin-only — `requireAdmin()`,
same guard already used for Inventory/Purchases/Settings. No finer-grained
visibility rule needed here (unlike Customer & Vehicle) since Sales Person
gets nothing in Reports, full stop.

**Export — flagged decision point.** Nothing in the PRD asks for CSV/PDF
export specifically for Reports (Courier Labels already has its own PDF
export elsewhere). Recommend: **screen-only for this pass**, relying on the
browser's own print-to-PDF for anyone who needs a hard copy, same as every
other list page today. Say so if you want a "Download CSV" button on each
report — buildable, just scoping it out unless asked for.

## 1. Inventory Report (spec §4.12)

**Purpose:** what's on the shelf right now, and what's just sitting there
not moving.
**Filters:** item type, brand, stock status — all reusing
`listInventoryItems`'s existing filter shape exactly.
**Shows:** stock table (item, type, brand, available qty, low-stock/
out-of-stock flag) plus summary cards from `getInventoryStats`
(`totalProducts`, `lowStock`, `outOfStock`, `inventoryValueCost`).
**New:** an **Ageing** column/flag — see §6 Ageing Stock below, which is the
same underlying data surfaced as its own dedicated report *and* as a column
here so it's visible without leaving the main Inventory Report.
**Data source:** 100% reuse (`listInventoryItems`, `getInventoryStats`) plus
the one new ageing-lookup function shared with §6.

## 2. Purchase Report (spec §4.12)

**Purpose:** what I've bought, from whom, and what it cost me, over a range.
**Filters:** date range, item type, brand — reusing `listPurchaseEntries`'s
existing filter shape exactly (it already supports all of these).
**Shows:** entries table (date, item, brand, quantity, unit price, total,
batch #) plus summary cards from `getPurchaseStats` (`totalPurchaseAmount`,
`entryCount`).
**Data source:** 100% reuse — this is closest to a "list page with a date
range" report, no new logic at all.

## 3. Sales Report (spec §4.12)

**Purpose:** what's actually selling.
**Filters:** date range, customer/search — reusing `listSales`'s existing
filter shape.
**Shows:** sales table (date, customer, invoice #, items, fitting charges,
grand total) plus summary cards from `getSalesStats` (`totalSalesAmount`,
`saleCount`).
**Flagged decision point — "by item" breakdown.** Spec §4.12 lists "item"
as a suggested filter/field, but `SaleLineItemRow` doesn't currently carry
`item_type`, so there's no way to filter/group by "how many Track Tyres did
I sell this month" without extending the sales↔inventory join (small
addition — `item_type` already lives on `inventory_items` and is already
joined for name/sku, just not selected yet). Recommend: **add `item_type`
to the join** so the report can filter by item type and show a small
"revenue by item type" breakdown card — worth doing since it's the same
join already in place, not a new query. Say so if you'd rather keep Sales
Report scoped to exactly what's already there (no item-type breakdown) for
now.
**Data source:** reuse (`listSales`, `getSalesStats`) + one small join
extension.

## 4. Service Report (spec §4.12)

**Purpose:** what work the shop is doing and what it's earning from labour.
**Filters:** date range — reusing `listServiceJobs`'s existing filter shape.
**Shows:** jobs table (date, job #, vehicle, status, labour vs. parts split,
grand total) plus summary cards from `getServiceStats`
(`grossCompletedRevenue`, `collectedRevenue`, `completedJobCount`).
**Flagged decision point — "service type" filter.** Spec §4.12 suggests
filtering by service type, but `listServiceJobs`'s filters today are
`search, status, dateFrom, dateTo` — no filter by which General Service
Package / Specific Service was performed. Recommend: **skip for this pass**
— a job can have multiple service lines, so "filter by service type" means
matching on any line, which is a real filter to add correctly, not a quick
one. The existing free-text `search` already partially covers this (it
matches job/invoice/customer/vehicle, not service line descriptions
though). Flagging as a good candidate for a later enhancement rather than
blocking this pass on it.
**Data source:** reuse (`listServiceJobs`, `getServiceStats`).

## 5. Customer Follow-Up / Leads Report — new, your idea

**Purpose:** who should I be calling right now — customers whose last tyre
purchase or last service is old enough that they're probably due, before
they go somewhere else.
**New query needed:** nothing today can answer "every customer past a
threshold" — existing functions only answer "this one customer's history."
Needs a new aggregate query, roughly: last `sale_date` per customer (from
`sales`) and last `completed_at` per customer (from `service_jobs` where
`status = 'COMPLETED'`), joined to customer contact info, filtered to those
older than the threshold.
**Filters:** two independent threshold inputs — **months since last
sale** (default **6**) and **months since last completed service**
(default **3**) — different because tyre life and service intervals are
genuinely different timescales. A customer can appear for either reason,
or both.
**Shows:** name, mobile number, reason ("Tyre — 7 months since last
purchase" / "Service — 4 months since last visit"), what they last bought
(item name — see below), date of that last activity, link to their full
Customer Detail page (reuses the module I just built).
**Flagged decision point — tyre-only vs. any sale.** Should "last sale"
mean *any* sale (oil, accessories, tyres — anything), or specifically their
last *tyre* purchase? Recommend: **any sale**, for now — a customer who
bought only engine oil 6 months ago is still worth a call, and restricting
to tyre-only risks missing real leads over a distinction that doesn't
matter much for a phone call. The report will show *what* they last bought
(reusing the same `item_type` join proposed in §3) so staff can tailor the
pitch either way. Say so if you'd rather the "Tyre" reason specifically
require their last sale to have contained a Track Tyre or Brand New Tyre
line.
**Excludes:** customers with no sales/service history at all (nothing to
measure "since" from) — not shown as false positives.
**Data source:** new aggregate query, shared `item_type` join extension
from §3.

## 6. Ageing Stock Report — new, your idea

**Purpose:** what's been sitting on the shelf too long — cash tied up in
slow-moving stock, and (if it's genuinely old rubber) something to discount
or push before it's unsellable.
**New query needed:** "oldest unsold batch per item" — `purchase_entries`
already has exactly what's needed for this (`purchase_date`,
`remaining_quantity` from the FIFO work), just never queried this way:
`select purchase_date from purchase_entries where inventory_item_id = X and
remaining_quantity > 0 order by purchase_date asc limit 1`, done per item
(or one grouped query across all items with `remaining_quantity > 0`).
**Filters:** one threshold input — **months since oldest batch** (default
**6**).
**Shows:** item, brand, oldest batch date, how long ago, remaining quantity
in that batch, that batch's unit cost (so you can see how much is tied up).
**Scope note:** this is about *shelf time*, not a manufacturer's printed
expiry date — nothing in the system tracks an actual tyre manufacture/
expiry date today, and adding that would mean a new column on
`purchase_entries` plus manual data entry at every purchase. Ageing Stock
answers the same underlying question (is this inventory getting stale)
using data that already exists, without that extra data-entry burden. If
you do want to track a literal printed expiry date later, that's a
separate, small addition on top of this.
**Data source:** new query, reusing existing `purchase_entries` columns.

## 7. Revenue Report (spec §4.12)

**Purpose:** period-over-period revenue trend — is the shop growing,
shrinking, or flat.
**Flagged decision point — scope of "revenue."** Dashboard's existing
`getTrackTyreSalesTrend` (`services/dashboard/trend.ts`) only tracks Track
Tyre *quantity*, not revenue, and is scoped to Track Tyre only — it's the
wrong shape for this. Recommend a **new, broader trend function**:
Sales revenue (`grand_total`) + completed Service revenue
(`grand_total`, `status = 'COMPLETED'`), bucketed daily/weekly/monthly the
same way Dashboard already buckets (reusing `services/dashboard/
date-range.ts`'s bucketing helpers rather than re-deriving them), shown as
a line/bar chart with a Daily/Weekly/Monthly toggle exactly like Dashboard's
existing chart component.
**Excludes:** Online Order revenue, for the same reason Dashboard's Profit
figure excludes it (scope note already agreed there) — kept consistent
rather than silently changing what "revenue" means between screens.
**Data source:** new trend function, reusing Dashboard's existing bucketing
utilities rather than writing new ones.

## 8. Profit Report (spec §4.12, corrected formula)

**Purpose:** are we actually making money, not just moving inventory.
**Formula:** `Sales Amount − Cost of Goods Sold`, **not** the PRD's literal
"Sales Amount − Purchase Amount" — same correction already applied to the
Dashboard (a restock month would otherwise look like a loss). Reuses
`getCostOfGoodsSold` (`services/dashboard/cogs.ts`) directly, no new cost
logic.
**Filters:** date range, with a Daily/Weekly/Monthly bucket toggle for the
trend view (same shape as Revenue Report above).
**Shows:** Sales Amount, Cost of Goods Sold, Profit — as both summary cards
for the selected range and a trend chart across buckets.
**Data source:** reuse (`getSalesStats`, `getCostOfGoodsSold`) + the same
new bucketing work as Revenue Report (can share one underlying trend
function parameterized by "revenue only" vs. "revenue and cost").

## 9. Online Orders Report (spec §4.12)

**Purpose:** how the online Track Tyre ordering channel is performing —
volume and how fast orders move through Verify → Approve → Dispatch.
**Flagged decision point — today's stats function is a snapshot, not a
range.** `getOnlineOrderStats` returns fixed counts (submitted, payment
verified, approved, dispatched *this month*) with no date-range parameter.
Recommend: **extend it to accept an optional date range** (same
`{ from?, to? }` shape every other stats function already uses), rather
than adding a second, parallel stats function — keeps one source of truth
for Online Orders counts instead of two.
**Filters:** date range.
**Shows:** counts per status in range, list of dispatched orders (date,
order #, customer, quantity Front/Back, amount), rejection count/reasons if
any.
**Data source:** extend existing `getOnlineOrderStats` + reuse
`listOnlineOrders` for the dispatched-orders table.

## 10. Non-goals for this pass

- No CSV/PDF export (§0, flagged — recommend deferring).
- No saved/scheduled reports (e.g. "email me the Sales Report every Monday")
  — out of scope per project rules (no notification integrations).
- No cross-report dashboard/overview beyond the report-picker landing page
  — that's what the actual Dashboard module already is.
- Service Report's "filter by service type" (§4) and Sales Report's
  item-type breakdown being *mandatory* rather than a nice-to-have (§3) —
  both flagged as later-enhancement candidates, not blockers.

## 11. Edge cases

- Any report's date range with zero matching records → clear empty state,
  not a blank table (same convention every list page already uses).
- Customer Follow-Up: a customer who has *only* ever had a service, never a
  Sale (or vice versa) — still eligible, just measured on whichever history
  they have; not required to have both.
- Ageing Stock: an item whose only batch has `remaining_quantity = 0`
  (fully sold through) — excluded entirely, nothing to flag.
- Profit Report showing a negative number (COGS exceeded Sales in that
  bucket) — shown honestly (e.g. in red), not hidden or floored at zero,
  same rule already applied on the Dashboard.
- Online Orders Report with a date range that has orders still sitting in
  `SUBMITTED`/`PAYMENT_VERIFIED` (not yet resolved either way) — counted in
  their current status, not excluded just because they haven't reached a
  final state yet.

---

Confirm this list — especially the five flagged decision points (§0 export,
§3 item-type join, §5 tyre-only vs. any-sale for Follow-Up, §7 revenue
scope, §9 extending vs. duplicating the Online Orders stats function) — and
I'll move to test cases next, in chat, per the module workflow.

---

## Addendum — GST Report added (`/reports/gst`)

**Purpose:** every Sale and completed Service Job billed with GST applied,
over a date range, combined into one list — for GST filing/reconciliation.
Not in the original PRD's report list (spec §4.12); added on request the
same way Customer Follow-Up and Ageing Stock were.

**Shows:**
- Summary cards: Taxable Value, GST Collected, Total Invoice Value (of GST
  bills only), and GST Bills count (Sales + completed Service Jobs
  combined — deliberately not framed as "N of M total bills", which would
  need two more queries for a number that doesn't help a GST filing).
- One combined, date-sorted table (not split into separate Sales/Service
  tables) with a Type column: Date, Type, Invoice #, Customer, Taxable
  Value, GST Rate, GST Amount, Grand Total.
- XLSX export, same convention as every other Report.

**Filters:** date range only, defaulting to This Month like every other
period-based Report.

**Scope/exclusions:**
- Voided sales excluded (corrections, not revenue — 0029, same as every
  other money figure).
- Service Jobs: only `status = 'COMPLETED'` and excludes `FREE_SERVICE`
  jobs, matching `getCollectionsReport`'s convention exactly.
- Bills with `gst_applicable = false` don't appear at all — this report is
  specifically about GST-billed activity, not a general invoice list (that's
  the Sales/Service Reports).

**GST Rate is derived, not stored.** Neither `sales` nor `service_jobs`
persists the rate that produced `gst_amount` — only the resulting amount is
saved (the Sales/Service forms default to 18% but let it be edited per
bill). The report re-derives it the same way the Sales/Service edit forms
already re-populate their own GST-rate field from a saved bill:
`round((gstAmount / taxableValue) × 10000) / 100`. Shows "—" rather than a
divide-by-zero artifact when there's no taxable value.

**Data source:** one new function, `getGstReport`
(`services/reports/gst.ts`) — two direct `sales`/`service_jobs` queries
scoped to `gst_applicable = true`, mirroring `getCollectionsReport`'s
two-source-merge shape rather than the paginated `listSales`/
`listServiceJobs` page/pageSize shape, since a GST filing period needs the
whole range at once, not a capped preview page.
