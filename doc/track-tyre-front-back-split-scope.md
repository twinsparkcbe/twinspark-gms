# Track Tyre Front/Back Split — Feature & Use-Case List

**Status:** Draft — module workflow step 1, awaiting confirmation before test
cases / implementation. Modifies the already-shipped Track Tyre singleton
behavior in Purchases/Inventory ([[track_tyre_single_brand]] memory,
`doc/inventory-purchase-simplification-scope.md`).

**Why:** Track Tyre is currently a strict singleton — one active
`item_type = TRACK_TYRE` row, hardcoded `product_name = "Track Tyre"`, one
purchase price, one selling price, one stock count. Front and back track
tyres are physically different (different size/cost), so they need separate
purchase price, selling price, and stock — not one blended item.

## Current behavior (for reference)

- `getActiveTrackTyreItem()` (`services/inventory/items.ts`) finds the one
  active `TRACK_TYRE` row, no matter what.
- Record Purchase → New Item, when Item Type = Track Tyre: brand is locked
  to the shared "Track Tyre" brand, product name is locked to the literal
  string `"Track Tyre"`, and if an active Track Tyre item already exists the
  form silently switches to "add a batch to it" instead of creating a new
  row (`record-purchase-dialog.tsx`).
- Edit Item Details locks the Product Name field whenever Item Type = Track
  Tyre.
- Sales, Service, and the generic item picker have **no** Track Tyre-specific
  code — they just list whatever active inventory items exist. This is why
  the split is purely an Inventory/Purchases change, as you said.

## Proposed model — two fixed variants, no schema change

Rather than adding a new DB column (`position`/`variant` enum), reuse the
existing `product_name` field and change the singleton rule from "one active
Track Tyre item total" to "one active Track Tyre item **per name**":

- Track Tyre gets a fixed 2-choice selector (not free text) instead of a
  locked single value: **Front** / **Back**, saved as
  `product_name = "Track Tyre - Front"` / `"Track Tyre - Back"`.
- Brand stays locked to the shared "Track Tyre" brand for both, unchanged.
- Each variant is its own `inventory_items` row → independent
  purchase_price, selling_price, available_quantity, stock status, batch
  history — this falls out for free once they're separate rows, no new
  mechanism needed.
- Singleton check becomes "is there an active Track Tyre item with this
  exact product name already" instead of "is there any active Track Tyre
  item" — same restock-instead-of-duplicate behavior, just scoped per
  variant instead of per type.

**Why this over a new `position` column:** the dedupe index
(`inventory_items_dedupe_idx`) is already keyed on
`(item_type, brand_id, lower(product_name))`, and Track Tyre already
special-cases `product_name` today (it's just hardcoded to one value). Two
fixed names is a drop-in extension of that existing pattern — zero
migrations, zero DB function signature changes, zero risk to Sales/Service/
Reports which already treat every inventory item generically by id. A
`position` column would mean threading a new field through the New Item
form, the DB function, and the dedupe constraint for a distinction that a
name already captures cleanly.

**Flagging this as the one real decision point** — if you'd rather have a
real `position` enum column (e.g. for cleaner filtering/reporting by
position later), say so and I'll scope that instead. Default above unless
you object.

## 1. Purchases — changed

### 1.1 Record Purchase → New Item, Item Type = Track Tyre
- Brand: unchanged (locked to shared "Track Tyre" brand).
- **New field: Position** — a required 2-option select, **Front** / **Back**
  (radio buttons or a small segmented control, not a text input). Replaces
  the current auto-filled, disabled Product Name field for this item type.
- Product name is derived, not typed: `"Track Tyre - Front"` or
  `"Track Tyre - Back"`.
- Singleton/restock check runs per position: picking Front when an active
  "Track Tyre - Front" item exists behaves like today (adds a batch to that
  item, shows the "already exists" banner); Back is checked independently.
  Having an active Front does **not** block creating a new Back, and vice
  versa.
- Selling Price, Purchase Price (unit price), Quantity, Low Stock Threshold,
  Supplier, Note, Purchase Date: unchanged fields, just apply to whichever
  variant is selected.

### 1.2 Record Purchase → Existing Item, Item Type = Track Tyre
- No change — the item picker already lists items by name, so once both
  variants exist they simply show as two distinct rows ("Track Tyre -
  Front", "Track Tyre - Back") to pick from, same as any other item.

### 1.3 Edit Item Details, Item Type = Track Tyre
- Product Name field: still not free-typed. Becomes the same Front/Back
  selector as 1.1 (so a mistakenly-created variant can be relabeled, but
  only between the two valid values — never arbitrary text). Brand stays
  locked as today.

### 1.4 One-time migration of the existing item (if one already exists)
- If a single "Track Tyre" item is already active in production with real
  stock/price/history: it does **not** get auto-split. You relabel it via
  Edit Item Details to whichever position it actually represents (Front or
  Back), then create the other variant as a normal New Item purchase entry.
  This is a manual data step for you post-deploy, not something the app
  does automatically — flagging so it's not a surprise.

## 2. Inventory — changed (display only)

- No new columns, no schema change. Once both variants exist, the table
  simply shows two rows instead of one: "Track Tyre - Front" and "Track
  Tyre - Back", each with its own stock/status, both still tagged with the
  Track Tyre type badge and Track Tyre brand.
- Search/filter/sort behavior: unchanged — they already operate per-row.

## 3. Sales, Service, Reports, Online Orders — unchanged

- Confirmed via code check: none of these reference Track Tyre specially.
  They pick/report on inventory items generically by id, so two rows just
  appear as two selectable items with independent prices/stock. No code
  changes needed in these modules for this request.

## 4. Data Model Changes

- **None**, under the recommended approach — no migration, no new column,
  no DB function signature change. `getActiveTrackTyreItem()` gains a
  required `productName` (or `position`) parameter and adds
  `.eq("product_name", exactName)` to its existing query; everything else
  (`create_inventory_item_with_purchase`, `record_purchase_entry`, dedupe
  index, RLS) is untouched.

## 5. Validation & Edge Cases

- Position is required whenever Item Type = Track Tyre in New Item mode —
  can't submit without picking Front or Back.
- The existing dedupe unique index already prevents two *active* items
  sharing the same exact name, so "Track Tyre - Front" can't accidentally
  be created twice — same guarantee as today, just per-variant instead of
  per-type.
- Deactivating one variant (e.g. Front discontinued) doesn't affect the
  other — independent `is_active` flags, as with any two separate items
  today.
- If more than one active row already exists for a given position name
  (shouldn't happen going forward, but matches today's documented fallback
  for pre-existing duplicates): most-recently-created wins, same as the
  current `getActiveTrackTyreItem()` behavior.

---

Confirm this list (especially the Front/Back-as-name vs. new-column
decision in the "Proposed model" section) and I'll move to test cases next,
per the module workflow.
