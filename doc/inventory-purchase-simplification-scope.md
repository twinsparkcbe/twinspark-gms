# Inventory / Purchase Responsibility Split — Feature & Use-Case List

**Status:** Draft — module workflow step 1, awaiting confirmation before test
cases / implementation. Restructures the already-shipped Inventory and
Purchase modules (`doc/purchase-module-scope.md`,
`doc/purchase-batch-fifo-scope.md`).

**Why:** item creation currently lives in Inventory, batch/price tracking
lives in Purchases — two places touch the same item, which is confusing.
Purchases becomes the single place that creates items, records batches, and
sets prices. Inventory becomes read-only + stock adjustments.

Decisions already confirmed (asked before writing this):

- Item-level `selling_price` stays, but becomes an **auto-synced reference**
  — always mirrors the item's newest batch, same treatment `purchase_price`
  already gets. Not directly editable anywhere.
- Editing an existing item's master data (name, SKU, brand, type, low-stock
  threshold, active/inactive) moves into Purchases entirely.
- Inventory's table keeps Brand/Type/SKU columns and the existing
  search/brand/type filters — only Purchase Price and Selling Price columns
  and the Add/Edit Item actions are removed.
- Every existing `purchase_entries` row gets backfilled with a selling price
  (from the item's current `selling_price`) so the column can become
  `NOT NULL` going forward.
- Adjust Stock's reason list expands from 3 generic labels to 7 specific
  ones (§2.2) — no DB enum change needed.

Considered and explicitly declined for this pass (confirmed out of scope,
not overlooked):

- **Multi-line purchase invoice** (one save, several product lines) — stays
  one item per Purchase Entry.
- **Purchase Orders / partial receiving** — a Purchase Entry always means
  stock physically in hand right now; no separate "ordered" state.
- **Void/cancel a saved Purchase Entry** — Purchase Return already covers
  correcting a mistaken entry; no separate cancel action.

---

## 1. Purchases Module — New/Changed

### 1.1 Record Purchase gains a New Item / Existing Item mode

- A toggle at the top of the Record Purchase dialog: **Existing Item**
  (today's flow — item picker + batch fields) or **New Item**.
- **New Item** expands the form to also collect the item's master data —
  the same fields Inventory's Add Item form collects today: Product Name,
  SKU (optional, auto-generated if blank), Item Type, Brand (with inline
  "create new brand", Track Tyre still forced to the single shared "Track
  Tyre" brand per existing behavior), Low Stock Threshold.
- Batch fields are unchanged from today's Record Purchase, except **Selling
  Price becomes required** (no longer the optional override built last
  turn — every batch always has one).
- Submitting **New Item** creates the item and its first batch in one
  atomic step (new DB function — see §3) — never a state where the item
  exists but the opening batch failed, or vice versa.
- Track Tyre stays a singleton: picking "New Item" + Track Tyre when an
  active Track Tyre item already exists behaves like today's restock path
  (adds a batch to the existing item) rather than creating a duplicate row.

### 1.2 Edit Item Details (new, moved from Inventory)

- A new action on the Purchases screen (from the item picker and/or
  Purchase History rows) opens an **Edit Item Details** dialog: Product
  Name, SKU, Item Type, Brand, Low Stock Threshold, Active/Inactive.
- Never touches price or stock — those only ever come from batches /
  Adjust Stock.
- Deactivate/reactivate and delete-if-no-history rules carry over unchanged
  from today's Inventory behavior.

### 1.3 Existing Purchases features — unchanged

- Purchase History table, filters, sort, Purchase Stats.
- Purchase Return (targets a specific batch, FIFO-aware remaining quantity).
- FIFO batch consumption on any stock decrease elsewhere in the app.

## 2. Inventory Module — Reduced

### 2.1 Removed entirely

- **Add Item** button/dialog.
- **Edit Item** button/dialog (moved to Purchases, §1.2).
- The Track Tyre restock-via-Add-Item quick path (restocking is now always
  a Purchase Entry — the ordinary "existing item" flow already covers this
  since Track Tyre is just another item to pick).
- **Opening Stock** as an adjustment reason/concept — every stock increase
  now originates either as a real Purchase batch or, for corrections, the
  existing synthetic-batch mechanism under Manual Correction. Nothing needs
  a separate "opening" label anymore since item creation always comes with
  a first batch.
- Purchase Price / Selling Price columns from the Inventory table and CSV
  export (still exportable from Purchases if needed later — not requested
  here).

### 2.2 Kept

- Table: Product (name, SKU, thumbnail), Type, Brand, Available Stock
  (with reorder-line progress bar), Status (In Stock / Low Stock / Out of
  Stock) — i.e. today's table minus the two price columns.
- Search, Type filter, Brand filter, Stock Status filter, sort (Newest,
  Name, Stock — "Price" sort option removed along with the price columns).
- **Adjust Stock** — same mechanics (Quantity +/-, optional Note, optional
  Cost per Unit on positive adjustments only, falls back to the item's last
  batch cost), but the reason list expands from 3 generic labels to 7
  specific ones: Damaged, Manufacturing Defect, Lost/Missing, Customer
  Return, Supplier Return, Manual Correction (replaces "Stock-take
  correction" — same meaning), Other. Still the only place Inventory can
  change stock.
  - No DB migration needed — all 7 labels still map down to the existing
    `DAMAGE` / `MANUAL_CORRECTION` enum values (Damaged, Manufacturing
    Defect, Lost/Missing → `DAMAGE`; Customer Return, Supplier Return,
    Manual Correction, Other → `MANUAL_CORRECTION`), same admin-only +
    note-required rules as today. The label itself carries the specific
    meaning in the audit trail; the DB enum only needs to know the coarse
    category.
  - **Supplier Return** here is a quick generic decrease (no specific batch
    picked) — distinct from Purchases' existing **Purchase Return**, which
    targets one exact batch and validates against its remaining quantity.
    Both stay: use Purchase Return when you know which batch, this when you
    don't/it doesn't matter.
  - **Customer Return** (positive) uses the same synthetic-batch-cost
    mechanism as any other positive correction.
- Stock movement / adjustment history (audit trail) — unchanged.

## 3. Data Model Changes

- `purchase_entries.selling_price_override` → renamed `selling_price`,
  backfilled from each item's current `selling_price` for existing rows,
  then set `NOT NULL`. `record_purchase_entry()`'s selling-price parameter
  becomes required (no more null-means-"use item price" fallback).
- `inventory_items.selling_price`: `record_purchase_entry()` now updates it
  on every new batch, the same way it already updates `purchase_price` —
  both become auto-synced "reference" values, never directly editable.
- New DB function `create_inventory_item_with_purchase(...)`: inserts the
  item, creates its first batch, and calls the shared `adjust_stock()` path
  — all inside one transaction, so New Item in Purchases can never leave a
  half-created item.
- `STOCK_ADJUSTMENT_REASONS` drops `"Opening Stock"`.
- Inventory's `createInventoryItem`/`updateInventoryItem` service functions
  and their Server Actions move from `services/inventory` /
  `app/(app)/inventory/actions.ts` to `services/purchases` /
  `app/(app)/purchases/actions.ts` (reusing the existing Zod schema,
  brand-combobox, and SKU auto-gen logic as-is — not rewritten).

## 4. Validation & Edge Cases

- New Item + existing SKU/name collision: same uniqueness rules as today's
  Add Item (SKU auto-gen avoids collisions; no explicit name-uniqueness
  constraint today, unchanged).
- New Item submitted with quantity 0: not allowed — every item needs at
  least one batch to exist meaningfully under this model (mirrors "every
  unit needs a cost basis" from the FIFO scope doc). Minimum quantity 1.
- Editing Item Details to Inactive: existing rule stands — items with
  purchase/stock history are deactivated, never hard-deleted.
- Adjust Stock in Inventory still can't be used to create a brand-new item
  or backfill a missing one — it only ever operates on an `itemId` that
  already exists.

## 5. What Doesn't Change

- `adjustStock()`/`adjust_stock()` stays the single path that mutates
  `available_quantity` — New Item's first batch goes through it exactly
  like every other batch.
- FIFO consumption, Purchase Return's batch-targeting, and the shared
  component set (tables, dialogs, filters) are all reused as-is.
- Admin-only access to both modules (Sales Person restricted from both) —
  unchanged.
