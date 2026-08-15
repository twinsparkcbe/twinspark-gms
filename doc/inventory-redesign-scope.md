# Inventory Redesign — Feature & Use-Case List

Presentation rework of the Inventory screen. The module's role is unchanged
and stays as agreed in `doc/inventory-purchase-simplification-scope.md`:
**view + stock adjustments only.** No item creation, no pricing, no editing of
master data — all of that remains in Purchases. Access is unchanged: Admin
only.

---

## 1. Problem being solved

The owner opens Inventory to answer one of four questions. Today only the
third is served, and slowly.

| Question | Served today? |
|---|---|
| What do I need to reorder? | No — the 12 urgent items are scattered through 268 identical-looking rows |
| How much stock am I holding, in ₹? | No — `InventoryStatsCards` is entirely commented out |
| Do I have *this* item, and how many? | Yes, via search |
| What changed on this item recently? | No — only a relative "Updated 3d ago" with no detail |

Concrete faults in the current screen:

- Every row is visually identical. Status is a badge in column 5, so urgency
  is only visible if you scan that one column.
- Default sort is `created_at desc` — newest first, which correlates with
  nothing the owner cares about.
- Rows are ~76px tall (thumbnail + three stacked text lines), so roughly 8
  fit on screen out of 25 per page.
- The list sits in a fixed `h-[52vh]` scroll container, so a filtered view
  showing 2 items still reserves half the viewport as blank space.
- `InventoryStatsCards` renders an empty grid — dead markup shipping to the
  browser.

---

## 2. New layout (top to bottom)

1. **Header** — "Inventory" + a one-line summary (item count, cost value,
   attention count), with Export and New Purchase on the right.
2. **Filter row** — search, type, brand. Unchanged behaviour.
3. **Status chips** — All / In stock / Low / Out of stock, each carrying a
   count, each acting as the status filter.
4. **Reorder now strip** — compact cards for items needing action.
5. **Item list** — denser rows, urgency-sorted, status carried as row tint.
6. **Pagination** — unchanged.

---

## 3. Features

### 3a. Header summary line

- `268 items · ₹4,21,500 at cost · 12 need attention`.
- All four figures already exist on `InventoryStats` (`totalProducts`,
  `inventoryValueCost`, `lowStock`, `outOfStock`) — **no new query.**
  "Need attention" is `lowStock + outOfStock`.
- Replaces `InventoryStatsCards` entirely. That component is deleted, not
  re-enabled — four large cards for four numbers was why it got commented out.
- New Purchase links to `/purchases?action=new`, matching the dashboard
  action bar. Inventory still creates nothing itself.

### 3b. Status chips

- Four chips: All, In stock, Low, Out of stock.
- Counts: `totalProducts`, `totalProducts − lowStock − outOfStock`,
  `lowStock`, `outOfStock`. Again no new query.
- Clicking a chip sets `filters.stockStatus`; the active chip is outlined.
  This **replaces the status dropdown** in `InventoryFilters` — one control
  doing the job of two, and the counts make it self-explanatory.
- Low and Out chips keep their warning/danger tint even when inactive, so the
  problem is visible before any interaction. They render in a muted neutral
  style when their count is 0, so an all-healthy catalog doesn't show a red
  chip.

### 3c. Reorder now strip

- Shows up to 6 items with `stock_status` of `out_of_stock` or `low_stock`,
  out-of-stock first, lowest quantity first.
- Each card: product name, then `0 left · reorder at 5` (confirmed — stock
  and threshold only, both already on the row; **no sales-velocity query**).
- Card click deep-links to `/purchases?action=new&itemId=<id>` so the owner
  goes straight from "I'm out" to "restock it".
- The whole strip is hidden when nothing needs reordering — no empty-state
  card, no dead heading.
- Fed by the items already on the page where possible; when the current page
  or filter excludes them, it needs its own small query (see 3g).

### 3d. Urgency-first sort

- New `"urgency"` value on `InventoryItemSort`, and it becomes the default
  (replacing `"newest"`).
- Implemented as `stock_status desc, available_quantity asc, product_name asc`.
  `stock_status` is a generated **text** column
  (`supabase/migrations/0001_inventory_schema.sql`), so descending
  alphabetical happens to be exactly urgency order:
  `out_of_stock` → `low_stock` → `in_stock`. That's a coincidence of naming,
  not a designed ordering, so it gets an explicit unit test — if a status is
  ever renamed the sort would silently invert.
- **No migration required.** The existing `inventory_items_stock_status_idx`
  already covers the leading sort column.
- The existing newest / name / stock sorts stay available in the dropdown.

### 3e. Denser rows

- Columns become: Product · Type · Brand · Stock · (chevron). The **Status
  column is removed** — status is carried by the row tint and the coloured
  stock figure instead.
- Row height drops from ~76px to ~52px:
  - "Updated 3d ago" moves into the detail drawer.
  - Stock, progress bar and threshold collapse into `0 / 5` plus the bar.
  - Thumbnail 44px → 32px.
- Row tint: `bg-danger-bg` for out of stock, `bg-warning/10` for low, white
  otherwise. Tint is the only status signal that survives peripheral vision.
- Colour is never the *sole* carrier: the stock figure is also coloured **and**
  reads `0 / 5`, so the state is legible without colour perception.
- The fixed `h-[52vh]` scroll container is dropped — the list sizes to its
  content and the page scrolls normally.

### 3f. Item detail drawer

- Replaces the row's kebab menu. The whole row is the target; the chevron is
  an affordance, not a separate hit area.
- Opens a right-side drawer showing:
  - Header: image, product name, SKU, type, brand, active status.
  - Stock: available quantity, reorder threshold, current status.
  - Reference prices: purchase and selling, clearly labelled read-only and
    "from the latest purchase batch" (they're auto-synced mirrors and are not
    editable anywhere — see `doc/inventory-purchase-simplification-scope.md`).
  - **Stock history**: last 20 `stock_movements` rows for the item — date,
    reason, delta, resulting balance. This is the "what changed?" question,
    currently unanswerable in the UI.
  - Actions: Adjust Stock (existing dialog, unchanged) and a link to
    Purchases for anything else.
- Adjust Stock remains the only write action on this screen.

### 3g. New queries

Only two, both small:

1. `listReorderItems(supabase, limit)` — active items with
   `stock_status in ('out_of_stock','low_stock')`, ordered
   `stock_status desc, available_quantity asc`, limited to 6. Deliberately
   ignores the page's filters: "what do I need to buy" shouldn't change
   because the owner typed a search term.
2. `listStockMovements(supabase, itemId, limit)` — the drawer's history, from
   the existing `stock_movements` table.

`getInventoryStats` is reused as-is. No schema change, **no migration to apply.**

---

## 4. Use cases

| # | Actor | Flow |
|---|---|---|
| U1 | Admin | Opens Inventory → reads the summary line → knows holding value and that 12 items need action, without clicking |
| U2 | Admin | Scans the reorder strip → clicks an item → lands in a pre-filled new Purchase |
| U3 | Admin | Opens Inventory → the first rows *are* the problems, because of urgency sort → no filtering needed |
| U4 | Admin | Clicks the "Out of stock 8" chip → list narrows to those 8 |
| U5 | Admin | Searches a SKU → clicks the row → drawer shows current stock and the last 20 movements |
| U6 | Admin | Finds a count is wrong → Adjust Stock from the drawer → drawer and row both reflect the new quantity |
| U7 | Admin | Healthy catalog, nothing low → no reorder strip, Low/Out chips render muted at 0, list is plain white rows |
| U8 | Admin | Filters to a type with 2 matches → the list is two rows tall, not two rows floating in a half-screen box |

---

## 5. States

- **Loading** — first load shows skeleton rows; a filter/page change keeps the
  current rows dimmed rather than blanking the list. Unchanged behaviour, but
  the skeleton must match the new denser row height.
- **Empty (filtered)** — "No items match your filters", unchanged.
- **Empty (no inventory)** — "Add your first product from Purchases",
  unchanged.
- **Error** — a failed stats or reorder query must not blank the item list;
  the affected section is hidden and the list still renders.
- **SSR/hydration** — the page keeps its `loading.tsx`, and the skeleton is
  updated to the new layout. No time-dependent values in a client render path.
  `RelativeTime` moves into the drawer, where it stays a client component with
  its existing hydration-safe behaviour.

---

## 6. Explicitly out of scope

- Item creation, editing master data, or any price editing — Purchases owns
  all of it.
- Sales velocity / "sold N last month" on reorder cards (asked, declined —
  threshold-only was chosen).
- Bulk actions, multi-select, inline editing of quantities.
- Saved views, per-user column preferences, drag-to-reorder columns.
- Barcode scanning, stock-take mode, supplier reorder emails.
