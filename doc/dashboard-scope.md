# Dashboard — Feature & Use-Case List

**Status:** Draft — module workflow step 1, awaiting confirmation before test
cases / implementation.
**Relationship to source docs:** Implements spec §4.2 (Dashboard), the
Dashboard row of the §6 permission matrix (Administrator ✅ / Sales Person
❌), and rule §17 ("Low-stock items automatically surface on the Dashboard").
**Standards carried over:** this module adds **no new tables, no new RPCs,
and no new stats logic** — it's a read-only aggregation screen over data
that already exists. Every number on it is produced by stats functions the
Inventory/Purchases/Sales/Service modules already ship and already unit-test:
`getInventoryStats` (`services/inventory/items.ts`), `getPurchaseStats`
(`services/purchases/entries.ts`), `getSalesStats` (`services/sales/sales.ts`),
and `listInventoryItems` (same file, filtered by `stockStatus`) for the
low-stock list itself. This keeps Dashboard a thin composition layer, not a
place where aggregation rules get duplicated or drift from the modules that
own them.

**Why this module matters (owner's view):** I want one screen I can glance at
each morning — how much stock of track tyres do I actually have left, did we
make money this month, and is anything about to run out — without having to
open Inventory, Purchases, and Sales separately and do the subtraction myself.

---

## Addendum — Profit corrected to Cost of Goods Sold, not raw Purchase Amount

Originally implemented as `Profit = Sales Amount − Purchase Amount`, matching
spec rule §16 and the PRD's Profit Report definition literally. This is
**wrong for a running Dashboard**: Purchase Amount is everything bought in
the period, most of which sits on the shelf unsold — a big restock month
reads as a loss even in a genuinely profitable month, and the opposite
(selling through old stock with no new purchases) reads as inflated profit.

**Corrected:** `Profit = Sales Amount − Cost of Goods Sold`, where Cost of
Goods Sold is the exact FIFO cost of only the units actually sold in the
period (`getCostOfGoodsSold`, `services/dashboard/cogs.ts`) — computed from
`stock_movements` rows with `reason='SALE'`, each already linked to the
specific purchase batch it was drawn from (`purchase_entry_id`, set by
`adjust_stock()`'s FIFO consumption loop, 0010_purchase_batch_fifo.sql), at
that batch's real `unit_price`. No new tracking needed — the batch-cost
linkage already existed for other reasons; this is the first thing to read
it back out.

Purchase Amount stays on the Dashboard as its own card (a cash-outlay/
restocking figure), just no longer feeds Profit.

**Scope note:** Cost of Goods Sold only counts `reason='SALE'` (in-store
Sales module), matching what Sales Amount already counts — Online Order
dispatches are excluded from both sides on purpose, so revenue and cost stay
on the same footing. If Online Orders revenue is ever folded into Sales
Amount, Cost of Goods Sold needs the same change at the same time.

**This supersedes the pinned project rule** ("Profit is calculated as: Profit
= Sales Amount − Purchase Amount") for the Dashboard. Flagging for the
Reports module's future Profit Report (spec §4.12): it should use this same
corrected definition, not the PRD's literal text, for consistency.

## 1. Metrics displayed (spec §4.2)

All monetary/count metrics below default to **the current calendar month**,
matching the existing default behavior of `getSalesStats`/`getPurchaseStats`
(both already default their date range to `startOfMonth(now)` → `now` when no
range is passed) — no new date-range picker in this pass (see §5 non-goals).

1. **Current Track Tyre Stock** — `available_quantity` for the two Track
   Tyre inventory rows (`Track Tyre - Front`, `Track Tyre - Back`), shown as
   two numbers, not one combined count — same Front/Back split already used
   everywhere else (Purchases, Inventory, Online Orders) since they're
   independent stock rows.
2. **Total Sales** — count of sales this month (`getSalesStats().saleCount`).
   **Flagged decision point:** the spec literally says "Total Sales (count
   and/or amount — clarify with client which is meant)". Recommend: **Total
   Sales = count**, and the ₹ figure lives in its own "Sales Amount" card
   (metric 4 below) — that reads as two distinct, non-redundant cards rather
   than one ambiguous one. Say so if you'd rather "Total Sales" itself show
   the ₹ amount instead of a count.
3. **Purchase Amount** — this month's total (`getPurchaseStats().totalPurchaseAmount`).
4. **Sales Amount** — this month's total (`getSalesStats().totalSalesAmount`).
5. **Profit** — `Sales Amount − Purchase Amount` (rule §16), computed
   client-side from metrics 3+4, not stored anywhere.
6. **Current Month Revenue** — per spec this is a separate card from "Sales
   Amount", but with no date-range picker in this pass, both would show the
   exact same number (this month's sales total). **Flagged decision point:**
   recommend **merging these into one card** ("Sales Amount (This Month)")
   rather than showing the identical figure twice — say so if you want them
   kept as two separate cards anyway (e.g. because a date-range picker is
   coming in a later pass and they'll diverge then).
7. **Low Stock Alerts** — see §2 below.

## 2. Low Stock Alerts (rule §17)

- Auto-populated list of active inventory items where
  `available_quantity ≤ low_stock_threshold` — this condition is already
  computed and stored as `stock_status` on every item (`low_stock` or
  `out_of_stock`, set by the same DB trigger that maintains stock), so the
  list is just `listInventoryItems(supabase, { stockStatus: ... })` filtered
  to those two statuses, no new query logic.
- **Flagged decision point:** the spec's threshold condition
  (`available_quantity ≤ low_stock_threshold`) mathematically covers
  `out_of_stock` items too (0 is always ≤ a positive threshold). Recommend
  showing **both** `low_stock` and `out_of_stock` items in this list, with a
  small badge distinguishing "Out of Stock" from "Low Stock" per row — say so
  if you want Out of Stock excluded and shown as its own separate section (or
  not shown on Dashboard at all, only in Inventory).
- Each row: product name, brand (if any), current quantity, threshold, stock
  status badge — clicking a row (or a "View in Inventory" link) navigates to
  `/inventory` pre-filtered to that item's search term, so this list is a
  jumping-off point, not a dead end.
- Capped to a reasonable number on the Dashboard itself (e.g. top 10 by lowest
  quantity first) with a "View all N low-stock items →" link to the full
  Inventory list filtered to Low Stock/Out of Stock — avoids the Dashboard
  turning into a second full Inventory table if the list is long.

## 3. Layout

- Stat cards at the top (Track Tyre Stock ×2, Total Sales, Purchase Amount,
  Sales Amount, Profit) — same card component already used for
  Inventory/Purchases/Sales/Service stats bars, just a different set of
  numbers, so no new UI primitive.
- Quick Actions row (see §3a below) directly under the stat cards.
- Low Stock Alerts as a table/list section below the cards, using the
  existing shared table component conventions (same as every other module's
  list view — empty state, loading skeleton).
- No filters, no pagination controls beyond the "View all" link above — this
  is a summary screen, not a management screen.

## 3a. Quick Actions (shortcuts)

Four buttons/cards so the owner can jump straight into the action they came
for, instead of Dashboard → sidebar → module → New every time:

- **New Sale** → `/sales/new` (existing dedicated route, no changes needed).
- **New Service Job** → `/service/new` (existing dedicated route, no changes
  needed).
- **New Purchase Entry** → `/purchases`, then auto-opens the existing
  "Record Purchase Entry" dialog (`recordDialogOpen` state in
  `purchase-page-client.tsx`) rather than a separate route, since Purchases
  has no dedicated `/purchases/new` page today — entries are created via a
  dialog on the list page itself. Implementation: a `?action=new` query
  param that `PurchasePageClient` checks on mount to open the dialog, then
  strips from the URL (`router.replace`) so a page refresh doesn't re-open
  it. Small addition to that component, not a new page.
- **Online Orders** → `/online-orders` (the admin verify/approve/dispatch
  queue) — confirmed: there's no admin-side "create an order" flow today
  (customers submit via the public `/order` form; admin/sales only verify,
  approve, dispatch), so this shortcut jumps to the queue itself rather than
  opening a new-order form.
- All four are hidden from Sales Person along with the rest of the Dashboard
  (Admin-only page, §4) — no separate visibility rule needed here.

## 4. Access & permissions

- **Administrator only** — Sales Person has no Dashboard access at all (spec
  §4.2, §6 permission matrix, and already enforced today: `"dashboard"` is
  already in `SALES_PERSON_BLOCKED` in `lib/auth/permissions.ts`). This
  module needs a `requireAdmin()`-style guard (or the existing admin-only
  helper if one already exists) on both the page and any server actions —
  no new role logic to design, just apply the existing pattern.
- Sales Person hitting `/dashboard` directly gets redirected the same way
  other blocked modules already redirect them today.

## 5. Non-goals for this pass

- No date-range picker / custom period selection — every metric is "this
  month," matching rule of thumb already used by `getSalesStats`/
  `getPurchaseStats`. Flagged in §1 as something that would make "Sales
  Amount" vs. "Current Month Revenue" meaningfully different if added later.
- No charts/graphs (trend lines, bar charts over time) — spec §4.2 only
  lists point-in-time metrics and a low-stock list, nothing about historical
  visualization. Can be a later Reports-module concern instead.
- No Online Orders figures on this Dashboard — spec §4.2 doesn't mention
  online orders at all; that data stays in the Online Orders module's own
  stats bar.
- No auto-refresh/live polling — same as every other module today, numbers
  reflect the page load, refreshed on manual reload or on relevant
  action (e.g. a Sale/Purchase/Dispatch elsewhere revalidates `/dashboard`
  the same way Dispatch already revalidates `/inventory`).

## 6. Edge cases

- No sales/purchases yet this month → cards show ₹0 / 0, not blank or an
  error (matches how Sales/Purchases stats bars already render a zero state).
- Both Track Tyre Front and Back items inactive/deleted → stock shows "—" or
  0 rather than throwing, since Dispatch/Online Orders already tolerate a
  missing active item for one position.
- No items currently low/out of stock → Low Stock Alerts section shows a
  clear empty state ("Nothing low on stock right now"), not an empty table
  with just headers.
- Profit is negative (purchases exceeded sales this month) → shown as a
  negative ₹ figure (e.g. in red), not hidden or floored at zero — an honest
  number matters more than a "nice" looking one here.

---

Confirm this list — especially the two flagged decision points (Total Sales
as count vs. amount, and merging "Sales Amount"/"Current Month Revenue" into
one card), the Low Stock Alerts scope (including Out of Stock items), and the
Quick Actions shortcuts (§3a, including Online Orders pointing to the queue
rather than a new-order form) — and I'll move to test cases next, in chat,
per the module workflow.
