# Purchase Management — Feature & Use-Case List

**Status:** Confirmed for build (module workflow step 1). Purchase Return is
in scope for this pass; Supplier Tracking is a plain optional text field
(both confirmed below, §4/§5 — no longer open).
**Relationship to source docs:** Supplements `Twinspark_Garage_Management_System_SPEC.md.pdf`
§3.7, §4.4, §6, §9(Q4), §4.12 (Purchase Report). Where this adds something not
in the PDF, it's marked **(new)**, with reasoning.
**Standards carried over from Inventory (`doc/inventory-module-scope.md`):**
shared `adjustStock()` as the only stock-mutating path, same filter/table/
pagination/stats-card UI pattern, same Zod-schema + Server Action + service
layering, same immutable-audit-trail approach, same toast/dialog/loading/
empty-state conventions. Purchase does not re-invent any of these.

---

## 1. Access

Administrator only (spec §6 permission matrix, and already fixed in project
instructions: Sales Person has no Purchases access).

## 2. Record Purchase (core flow)

- "Record Purchase" action → select an existing **active** Inventory item
  (same active-item picker pattern Sales/Service will use — Purchase never
  creates new catalog items; that's Inventory's job) → enter Quantity
  (positive integer) → enter Purchase Price paid **for this transaction**
  (decimal, > 0 — spec §3.7 explicitly notes this can differ purchase to
  purchase, even for the same item) → Purchase Date (defaults to now,
  editable for backdating) → optional Supplier Name (free text, §5) →
  optional Note.
- `total_amount = quantity × purchase_price` — computed, not entered.
- On save: calls the existing shared `adjustStock(itemId, +quantity,
  reason='PURCHASE', sourceModule='purchases', note)` — same function
  Inventory already uses, so there's one single stock ledger, not two.
- **(new)** A dedicated `purchase_entries` table logs the transaction itself
  (item, quantity, unit price, total, date, created_by, note). This is new
  schema. It's distinct from `stock_movements`: that's the generic ledger
  (every reason); this is Purchase-specific detail — unit price paid per
  transaction — needed for Purchase History, Purchase Report, and the
  Dashboard's Purchase Amount aggregate.
- **(new)** Inventory item's stored `purchase_price` (current reference cost)
  auto-updates to match the latest Purchase Entry's unit price on save.
  *Why: that field exists to represent "what this currently costs us" —
  leaving it stale after a real purchase defeats its purpose.* Historical
  price-per-transaction stays intact regardless, in `purchase_entries`.
- **(new)** Once this ships, Inventory's "New Purchase" quick-adjustment
  option (the stand-in used before this module existed) is removed — this
  screen replaces it as the one real way to record incoming stock. Small,
  tied-in cleanup, not a separate feature.

## 3. Purchase History

- Filterable, paginated list — same table/filter/sort/pagination pattern as
  Inventory's item list.
- Filters: item (search), item type, brand, date range.
- Sort: newest, item name, amount.
- Columns: Date, Item, Type, Brand, Quantity, Unit Price, Total Amount,
  Recorded By.
- **(new)** Immutable — entries are never edited or deleted after save, same
  as `stock_movements`. A mistake is corrected via Purchase Return (§4), not
  by editing history. *Why: consistent with the append-only audit-trail
  design already established for Inventory; editable purchase records would
  corrupt Purchase Report / Profit calc integrity.*

## 4. Purchase Return **(new — explicitly deferred from Inventory's scope for
this module, see `inventory-module-scope.md` §6. Confirmed in scope for this
build, not a later pass.)**

- Defective/wrong stock sent back to a supplier — reverses part of a
  Purchase.
- Decreases `available_quantity` via `adjustStock(itemId, -quantity,
  reason='PURCHASE_RETURN', sourceModule='purchases', note)` — requires a new
  `PURCHASE_RETURN` value added to the `stock_movement_reason` enum (small
  migration) and admin-only gating in `adjust_stock()`, mirroring how
  `PURCHASE`/`DAMAGE` are already gated.
- Linked to the original Purchase Entry (`return_of_purchase_entry_id`);
  return quantity can't exceed that entry's original quantity.
- Requires a reason/note (same rule as Manual Correction/Damage).
- No refund/accounting tracking — out of scope per project instructions
  (no accounting integration).

## 5. Supplier Tracking — confirmed (resolves spec §9, Q4)

Optional free-text `supplierName` field on each Purchase Entry — no separate
Supplier CRUD/master table. Satisfies Purchase Report's "supplier (if
tracked)" column (§4.12) without inventing a module nobody asked for.

## 6. Dashboard / Reports data contract (not building those modules now, but
Purchase must expose this cleanly for when we do)

- `getPurchaseStats(dateRange)` → aggregate Purchase Amount, feeding the
  Dashboard's `Profit = Sales Amount − Purchase Amount` (§4.2) and
  current-month figure.
- Purchase Report's fields (date range, item, quantity, price, supplier) are
  all covered by `purchase_entries` above — no extra work needed later.
- Stock Movement Report is already fed automatically via `adjustStock()` —
  Purchase entries land in `stock_movements` the same way Inventory
  adjustments do.

## 7. Validation Rules

- `quantity`: required positive integer.
- `purchasePrice` (this transaction's unit price): required, > 0.
- Only active Inventory items selectable (deactivated items hidden from the
  picker — same rule as Inventory doc §2).
- `purchaseDate` cannot be in the future.
- `supplierName`: optional, free text, no format constraint.
- Purchase Return quantity ≤ original entry's quantity minus any prior
  returns against it.

## 8. UI/Component Reuse (explicit — per your instruction to carry Inventory's
standards over, not rebuild them)

- Item picker: Inventory's active-item combobox (search by name/SKU).
- List screen: same filter bar + paginated table + stats cards + skeleton
  loading + empty state as Inventory's `InventoryFilters` /
  `InventoryTable` / `InventoryStatsCards` (renamed, same shape).
- Record Purchase: modal dialog, react-hook-form + zod, same
  validation-message conventions as Item Form Dialog.
- Purchase Return: confirmation-dialog pattern, same shape as Delete Item
  Dialog (destructive style, reason required).
- Toasts (sonner) for success/error — same as Inventory's actions.
- `app/(app)/purchases/actions.ts` Server Actions calling
  `services/purchases/*` — same layering as Inventory; no direct Supabase
  calls from components.

## 9. Access & RLS

- New `purchase_entries` table: admin-only read/write RLS, mirroring
  `inventory_items_admin_*` policies.
- `adjust_stock()`: no change needed for `PURCHASE` (already admin-gated);
  `PURCHASE_RETURN` gets the same admin-only gate added.
