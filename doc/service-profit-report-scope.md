# Service Profit Report (scope)

Confirmed 2026-09-02. Extends `doc/reports-scope.md`; nothing there is
withdrawn. Migration: `supabase/migrations/0041_service_parts_cost_snapshot.sql`.
Route: `/reports/service-profit`.

## 1. Why

Two reports already touch service money and neither answers the question the
shop actually asks — *does the service side make money?*

- **Service Report** shows labour and parts **billed**. It never shows what
  the parts cost, so a job that sold ₹3,200 of tyre bought at ₹1,900 reads
  identically to one that sold ₹3,200 of tyre bought at ₹3,100.
- **Profit Report** nets Sales, Online and Service into one figure against
  one shop-wide COGS number. It cannot separate the service side out.

Service work earns on two completely different footings, and mixing them is
what hides the answer:

| | Consumes stock? | What it earns |
|---|---|---|
| Labour and services — water wash, tyre fitting, general service, custom lines | No | **All of it.** Pure margin. |
| Spares / parts | Yes | Only what they were billed **above what those units cost**. |

## 2. What was missing in the data

Parts cost existed only in `stock_movements` (`reason='SERVICE_USAGE'`)
joined to its FIFO batch. That is exact shop-wide — it is what
`getCostOfGoodsSold()` uses — but it cannot be attributed to a job, because
`stock_movements` has no `service_job_id`. Two known consequences, both
already documented in `doc/diagnose_service_cost.sql` and
`doc/fix_orphaned_service_cost.sql`:

- Deleting a job leaves its cost behind with no revenue to match it (the
  whole reason the cleanup script had to re-label rows as
  `MANUAL_CORRECTION`).
- Editing or undoing a completed job restores stock at the item's **most
  recent** cost but re-deducts at **FIFO** cost. The gap stays in the ledger
  and compounds with every edit.

**0041 records the cost on the job instead.** `service_inventory_usage` gains
`cost_total` (the exact FIFO cost of that row) and `cost_is_estimated`.
`deduct_service_job_stock()` walks the same locked batches
`adjust_stock()` is about to drain, in the same transaction and the same
order, and stamps the cost as the stock leaves.
`restore_service_job_stock()` clears it, so an edit re-costs the row from
scratch rather than layering a correction on top.

Nothing about stock, revenue or any existing report changes. The Dashboard
and Profit Report still read `stock_movements`; this is a second, per-job
record written alongside them.

### Back-fill

- **Exact** — a job's stock leaves inside the transaction that stamps its
  `completed_at`, so movement `created_at` and job `completed_at` are the
  same instant. Matching on (instant, item), and only where the unit counts
  agree, recovers the real batch cost. Instants shared by two jobs are
  skipped rather than guessed at.
- **Estimated** — everything left (chiefly rows re-deducted by a later edit)
  is priced at the item's current `purchase_price` and flagged. The report
  shows these as `est.` and counts them in a banner, so an estimate is never
  silently read as an exact figure.
- Rows never deducted (drafts, jobs in progress) stay null — nothing has left
  the shelf, so there is no cost yet.

## 3. The numbers, and the decisions behind them

Per job:

```
profit = labour + parts billed − discount − parts cost
```

- **GST is excluded** from every profit figure. It is collected for the
  government and paid on to it; counting it would inflate profit by the tax
  rate. It is reported as its own figure so the total still reconciles
  against what was billed.
- **The job discount is subtracted whole** from that job's profit. It is
  money given away on that job, not a shop-wide adjustment.
- **A free service earns nothing and still costs.** Revenue is zero — nothing
  was collected and none was meant to be — while its parts cost exactly what
  they cost. Such a job shows a loss equal to its parts, which is the honest
  price of goodwill work, and the total is carried separately so it can be
  seen rather than blamed on the paying jobs around it.
- **Nothing is floored at zero.** A combo bills its parts at ₹0 and still
  consumed them; a part can be sold below cost. Both read as the loss they
  are.
- **Completed jobs only**, dated by `completed_at` — matching
  `getServiceStats`, the Revenue Report and the Dashboard: a job earns on the
  day it is billed, not the day the bike came in.

## 4. The screen

Summary: **Service Profit** (with job count) · **Labour & Services** (profit
in full) · **Parts Profit** (sold − cost), then a second row of Spares Sold ·
Spares Cost · Discount Given (with GST collected as its hint) · Free Service
Jobs (with the parts they consumed).

Table, newest first: Date · Job # / Invoice # · Customer / Vehicle · Labour ·
Parts Sold · Parts Cost · Discount · Profit. Free jobs carry a "Free" tag,
estimated costs an `est.` marker. Excel download carries every column
including the GST and the two flags. Same date-range control (`this_month` by
default) and Admin-only gate as every other report.

## 5. Where it lives

| Layer | File |
|---|---|
| Cost snapshot + back-fill | `supabase/migrations/0041_service_parts_cost_snapshot.sql` |
| Aggregation (pure, unit-tested) | `services/reports/service-profit.ts` (`buildServiceProfitReport`) |
| Query | same file (`getServiceProfitReport`) |
| Server action | `app/(app)/reports/actions.ts` (`fetchServiceProfitReportAction`) |
| Page | `app/(app)/reports/service-profit/page.tsx` |
| Screen | `components/reports/service-profit-report-client.tsx` |
| Card | `app/(app)/reports/page.tsx` |

## 6. Deliberately not done

- **The Profit Report and Dashboard are untouched.** They keep deriving
  service cost from `stock_movements`. Switching them onto the per-job
  snapshot would make them immune to the edit-drift and deleted-job problems
  too, and is the obvious follow-up — but it changes figures the owner reads
  daily, so it is its own decision rather than a side effect of adding a
  report.
- **No per-part breakdown inside a job.** The row-level cost is stored, so
  "which spare earns most" is one query away when it is wanted.
