# Inventory Management — Confirmed Feature & Use-Case List

**Status:** Confirmed for build (module workflow step 1).
**Relationship to source docs:** This supplements — does not replace —
`Twinspark_Garage_Management_System_SPEC.md.pdf` §3.4–3.6, §4.3, §5. Where this
file adds something not in the PDF, it's marked **(new)** below with the
reasoning for the addition.

---

## 1. Access

Administrator only. Sales Person has no access to any Inventory screen or
action (PRD §6 permission matrix).

## 2. Inventory Item Management

- List all inventory items across every type: Track Tyre, Brand New Tyre,
  Engine Oil, Chain, Sprocket Kit, Brake Part, Lubricant, Accessory, Other
  Spare Part.
- Add/Edit item form:
  - `item_type = TRACK_TYRE` → Category and Brand fields hidden, not stored.
  - `item_type = BRAND_NEW_TYRE` → Category and Brand required.
  - All other types → no category/brand.
  - `purchase_price` and `selling_price` are always two distinct required
    fields.
  - `low_stock_threshold`: required integer, ≥ 0.
- `available_quantity` is **read-only** on this form — never directly
  editable here; only changes via Purchase/Sale/Service/Adjustment flows.
- **(new)** Deactivate, not hard delete: an item with any Purchase/Sale/Service
  history can only be deactivated (`is_active = false`) — hidden from active
  pickers elsewhere (Sales/Purchase/Service item selection) but retained for
  historical invoices/reports. Items with zero history may be hard-deleted.
  *Why: hard-deleting an item referenced by past invoices would break those
  records.*
- **(new)** Search & filter: by product name (partial match), item type,
  category, brand, and stock status (In Stock / Low Stock / Out of Stock).
  *Why: not stated in the PRD, but the list spans 9 item types and will be
  unusable without it.*

## 3. Category & Brand Management

- CRUD for Category and Brand — used only for Brand New Tyre items.
- Cannot delete a Category/Brand referenced by an existing inventory item;
  block with a clear error (deactivate the item first).

## 4. Stock Movement (shared service, called by every other module)

- A single shared function — `adjustStock(itemId, delta, reason,
  sourceModule)` in `services/shared/stock.ts` (already scaffolded) — is the
  *only* code path allowed to change `available_quantity`. No UI anywhere
  edits it directly.
- Movement reasons: `PURCHASE` (+), `SALE` (−), `SERVICE_USAGE` (−),
  `ONLINE_ORDER_DISPATCH` (−), `MANUAL_CORRECTION` (±), `DAMAGE` (−).
- Every movement is logged — item, delta, resulting balance, reason, source
  module/record id, user, timestamp — full audit trail, never overwritten.
  This log is what will power the Stock Movement Report (PRD §4.12).

## 5. Manual Stock Adjustment **(new)**

*Why: the PRD leaves this as an open question; without it, the only way to
fix a miscount is faking a purchase or sale, which corrupts Purchase/Sales/
Profit reports.*

- Admin-only "Adjust Stock" action on an inventory item.
- Requires a reason category (`Stock-take correction`, `Damage/Write-off`,
  `Other`) and a free-text note.
- Can increase or decrease `available_quantity`.
- Logged via the shared stock movement log (`MANUAL_CORRECTION` or `DAMAGE`)
  — excluded from Sales/Revenue/Profit calculations.

## 6. Damage / Write-off **(new, scoped to Inventory only)**

- Modeled as a Manual Stock Adjustment with reason `DAMAGE`: decreases
  `available_quantity`, zero revenue impact, requires a note (e.g. "2 units
  damaged in transit").
- Appears in the Stock Movement Report as a distinct "Damage" line, separate
  from Sale/Service-usage outflows.
- **Explicitly out of scope for now:** Sales Return (customer returns a sold
  item — reverses part of a Sale + issues a credit note) and Purchase Return
  (defective stock sent back to a supplier — reverses part of a Purchase).
  Both touch Sales/Purchase/Billing, which haven't started their own module
  workflow yet — add these to *those* modules' feature lists when we build
  them, not here.

## 7. Low Stock Alerts

`available_quantity ≤ low_stock_threshold` → item surfaces on the Dashboard's
Low Stock Alerts list (PRD §4.2) and is filterable on the Inventory list
itself.

## 8. Validation Rules **(new)**

- `purchase_price`, `selling_price` must be > 0. `low_stock_threshold` must be
  ≥ 0.
- Warn (don't block) if `selling_price < purchase_price` — allow save, flag
  visually.
- `product_name` required; unique within the same `item_type` + `brand`
  combination, to prevent accidental duplicate SKUs.
