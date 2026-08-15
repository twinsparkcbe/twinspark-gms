# Dashboard Redesign — Feature & Use-Case List

Supersedes the layout described in `doc/dashboard-scope.md`. All existing
metrics, their definitions, and their business rules are unchanged — this
document covers the **presentation restructure** plus **three new derived
metrics**. Access control is unchanged: Admin only (Sales Person has no
Dashboard route at all), so no role branching is introduced.

---

## 1. Problem being solved

The current dashboard is six visually identical stat cards + a chart +
two right-rail cards. As the garage owner, three things fail:

| Problem | Consequence |
|---|---|
| All six metrics carry equal visual weight | Profit reads no more important than a stock count |
| Every figure is absolute, with no comparison | "₹5,400" is unjudgeable — good month or bad? |
| Quick Actions are low-contrast text links in the right rail | The most common daily task (billing a customer) is not the most prominent element |
| "Low Stock" mixes `low_stock` and `out_of_stock` in one flat list | An item at 0 looks the same as an item at 2 |
| Cards are ~150px tall for one number; chart is mostly empty | Heavy scroll, low information density |

---

## 2. New layout (top to bottom)

1. **Page header** — greeting + today's date (IST) on the left, date-range
   filter on the right. Replaces the currently-orphaned dropdown.
2. **Action bar** — horizontal row, replaces the right-rail Quick Actions card.
3. **Hero metrics** — 2 large cards: Sales Amount, Profit.
4. **Secondary strip** — 4 compact cells in one bordered group: Purchase
   Amount, Total Sales (count), Track Tyre Front, Track Tyre Back.
5. **Two-column row** — Track Tyre Sales chart (wider) + "Needs attention"
   panel (narrower), replacing the Low Stock Alerts card.

Nothing is removed. Every metric on the current dashboard still appears.

---

## 3. Features

### 3a. Action bar

- Four actions, unchanged destinations: New Sale (`/sales/new`), New Service
  Job (`/service/new`), New Purchase (`/purchases?action=new`), Online Orders
  (`/online-orders`).
- **New Sale is the single primary action** — solid `brand-red` fill. All
  others are outline buttons. Per the style guide, exactly one brand-filled
  action per view.
- Online Orders carries a count badge of orders awaiting dispatch (see 3e);
  badge is hidden entirely when the count is 0.
- Order is by daily frequency, not by module order.

### 3b. Hero metric cards — Sales Amount

- Value: `salesAmount` for the selected range (unchanged).
- **Delta vs previous comparable period** (see 3f) shown as a signed
  percentage with an up/down arrow, in the semantic success/danger colour.
- Subtext: the previous period's absolute value, e.g. "vs ₹4,580 last month".
- Sparkline: the same daily/weekly buckets already computed for the chart,
  rendered as a small line. No new query.

### 3c. Hero metric cards — Profit

- Value: `profit` = `salesAmount − costOfGoodsSold` (unchanged; the PRD's
  literal "sales − purchases" remains overridden, per `doc/dashboard-scope.md`).
- **Margin %** = `profit / salesAmount × 100`, shown beside the value.
- Delta vs previous comparable period, same treatment as 3b.
- Label carries an inline "sales − COGS" hint so the owner isn't left
  wondering why Profit ≠ Sales − Purchases.
- Negative profit renders in danger colour, never floored at zero.

### 3d. Secondary strip

- Purchase Amount, Total Sales (count), Track Tyre Front, Track Tyre Back.
- Purchase Amount also gets a delta vs previous period. Track Tyre stock does
  **not** — it's a live snapshot, not a period figure. Total Sales count does
  not (the money delta on the hero card already conveys the trend).
- Track Tyre Front/Back keep the "—" (not 0) rendering when the position has
  no active item.

### 3e. "Needs attention" panel

Replaces Low Stock Alerts. Three grouped sections, ordered by urgency:

1. **Out of stock** — active items with `stock_status = 'out_of_stock'`.
   Danger-tinted block, count + up to 3 item names + "+N more".
2. **Running low** — active items with `stock_status = 'low_stock'`.
   Warning-tinted block, count + the single lowest item + "and N others".
3. **Open work** — two counter rows:
   - Orders to dispatch: online orders with status in
     `SUBMITTED | PAYMENT_VERIFIED | APPROVED` (i.e. not yet `DISPATCHED`,
     not `REJECTED`). This is the same number that badges the Online Orders
     action button.
   - Service jobs open: service jobs with status in
     `DRAFT | IN_PROGRESS | READY_FOR_DELIVERY` (not `COMPLETED`, not
     `CANCELLED`).
   Both are live snapshots — **not** filtered by the date range, because
   "what's waiting on me right now" is not a period question.
- Each section links to its module (Inventory, Online Orders, Service).
- Empty state: when all three are zero, the panel shows a single calm
  "All clear" line, not three empty blocks.

### 3f. Previous-period comparison — resolution rules

Given the selected range `[from, to]`, the comparison range is computed as:

| Selected preset | Comparison range |
|---|---|
| Today | Yesterday, midnight to the same clock time |
| This Week | Previous week, Monday to the same weekday + clock time |
| This Month | Previous month, day 1 to the same day-of-month + clock time |
| Last Month | The month before it, in full |
| This Quarter | Previous quarter, start to the same offset |
| This Year | Previous year, Jan 1 to the same offset |
| Custom | Immediately preceding window of identical duration |

**Rationale:** for an in-progress period, comparing 12 days of August against
all 31 days of July is meaningless. The comparison always spans the same
elapsed duration as the selected range. All arithmetic stays in IST wall-clock
via the existing `ist-dates.ts` helpers.

### 3g. Delta display rules (edge cases)

| Previous | Current | Displayed |
|---|---|---|
| 0 | 0 | No delta shown at all |
| 0 | > 0 | "New" badge, success colour — not "+∞%" or "+100%" |
| > 0 | 0 | "−100%" |
| > 0 | > 0 | Signed % change, rounded to a whole number |
| ≤ 0 (profit only) | any | Absolute ₹ change instead of a %, since a % swing off a negative base is misleading |

Margin %: shown as "—" when `salesAmount = 0` (no divide-by-zero, and 0% would
falsely imply a break-even sale happened). Rounded to 1 decimal.

### 3h. Chart

- Same data and same Daily/Weekly/Monthly toggle. No logic change.
- Taller plot area; a dashed average line across the period.
- Zero-value buckets render as a thin baseline stub rather than nothing, so
  the axis reads as "no sales that day" instead of a gap.
- Subtitle gains the period total and the daily average.

---

## 4. Use cases

| # | Actor | Flow |
|---|---|---|
| U1 | Admin | Opens dashboard → reads Profit + margin + delta in one glance → decides whether the month is on track |
| U2 | Admin | Opens dashboard → clicks New Sale as the visually dominant action → bills a walk-in |
| U3 | Admin | Sees "4 items out of stock" → clicks through to Inventory → raises a purchase |
| U4 | Admin | Sees "3 orders to dispatch" badge → clicks Online Orders → dispatches (stock decrements on dispatch, unchanged rule) |
| U5 | Admin | Switches range to Last Month → every delta re-bases against the month before it |
| U6 | Admin | Picks a custom 10-day range → deltas compare against the preceding 10 days |
| U7 | Admin | First month of operation (no prior data) → deltas show "New" or nothing, never a broken value |
| U8 | Admin | A heavy restock month → Profit stays positive because it uses COGS, and the Purchase figure sits in the secondary strip where it can't be mistaken for the profit input |

---

## 5. States

- **Loading** — `loading.tsx` skeleton must mirror the new layout (action bar,
  2 hero cards, 4-cell strip, chart + panel) so there is no layout shift.
- **Empty** — zero sales in range: hero values render ₹0, no delta, chart
  shows an empty-state message rather than a flat axis.
- **Error** — a failure in any one metric group must not blank the whole page;
  the affected card shows an inline retry, the rest render.
- **SSR/hydration** — the greeting and date are time-dependent and must be
  computed server-side from IST and passed down as props. No `new Date()` in a
  client component render path (per the project's SSR standard).

---

## 6. Explicitly out of scope

Unchanged from `doc/dashboard-scope.md`: no SMS/WhatsApp, no multi-branch, no
accounting integration. Additionally not included here: customisable/draggable
cards, per-user dashboard preferences, CSV export from the dashboard, and any
metric not listed above.

---

## Addendum — Service Job revenue folded into Sales/Profit

**Problem:** Sales Amount and Profit only ever counted the Sales module
(walk-in retail). A garage that does substantial Service Job business (the
bigger revenue driver for most shops) had that revenue invisible on the
Dashboard, and Profit understated real profitability — a heavy-service,
light-retail-sales month could read as a loss even while the shop was
healthy.

**Corrected:**

- **New hero card: Service Amount** — gross revenue across COMPLETED Service
  Jobs in the selected range (`getServiceStats().grossCompletedRevenue`,
  `services/service/jobs.ts`, already existed but was unused by the
  Dashboard). Same delta-vs-previous-period treatment as Sales Amount (§3f).
  Hero row is now 3 cards (Sales Amount, Service Amount, Profit) instead of 2.
- **Profit** = `(Sales Amount + Service Amount) − Cost of Goods Sold`, where
  Cost of Goods Sold now sums `stock_movements` rows with reason **IN**
  `('SALE', 'SERVICE_USAGE')`, not `= 'SALE'` alone (`services/dashboard/cogs.ts`)
  — parts consumed by a completed Service Job carry the same FIFO batch-cost
  linkage as a Sale, so the same query just widens its filter. Revenue and
  cost stay on the same footing: adding Service revenue to the numerator
  without also subtracting Service part costs would have overstated Profit.
- **Margin %** (§3c) denominator becomes `Sales Amount + Service Amount`
  instead of `Sales Amount` alone.
- FREE_SERVICE jobs still count toward `grossCompletedRevenue` (their
  `grand_total` is typically ₹0 or a nominal fee) — no change to how
  `getServiceStats` itself defines revenue, this only wires the existing
  function into the Dashboard.
- Online Orders remain excluded from both Sales Amount and Cost of Goods
  Sold, unchanged from the original scope note.

---

## Addendum — Cash/UPI Collected added to the secondary strip

**Problem:** The owner could see how much was billed (Sales/Service Amount)
and how much it cost to earn (Profit), but not how much of that billing
actually came in, split by tender — needed to reconcile the physical cash box
against the bank/UPI account at day's end.

**Corrected:** Reuses `getCollectionsReport()` (`services/reports/collections.ts`,
built for the Collections Report, doc/payment-split-scope.md §8) rather than
re-deriving the tender split — same exclusions apply (voided sales,
`FREE_SERVICE` jobs), so the Dashboard and the full Collections Report can
never disagree on what counts as "cash" or "UPI" for the same range.

- **Two new secondary-strip cells: Cash Collected, UPI Collected** — the
  selected range's `getCollectionsReport().cash` / `.upi`. Strip grid widens
  from 4 to 6 cells (`md:grid-cols-3 lg:grid-cols-6`).
- **No previous-period delta** — matches Invoices/Track Tyre's treatment in
  the strip, not Purchases' (this is a "how much actually settled" snapshot
  of the same range, not a trend figure being tracked month over month).
- `unrecorded` and `outstanding` (also returned by `getCollectionsReport`)
  are deliberately NOT surfaced on the Dashboard — those live in the full
  Collections Report; adding them here would either duplicate that report or
  make the Dashboard strip too crowded for a glance-and-go summary screen.
