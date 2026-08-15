# Sales Management — Feature & Use-Case List

**Status:** Confirmed for build (module workflow step 1).
**Relationship to source docs:** Supplements `Twinspark_Garage_Management_System_SPEC.md.pdf`
§3.8, §3.9, §4.5, §4.10, §6. Where this adds or changes something not in the
PDF, it's marked **(new/changed)**, with reasoning — these came out of an
architecture discussion (owner-level, not engineering) about how Sales and
the future Service module should relate, confirmed point by point.
**Standards carried over from Inventory/Purchases:** shared `adjustStock()`
as the only stock-mutating path (already handles FIFO batch consumption and
the `SALE` reason — no new stock logic needed here), same filter/table/
pagination/stats-card UI pattern, same Zod-schema + Server Action + service
layering, same toast/dialog/loading/empty-state conventions. Sales does not
re-invent any of these.

---

## 1. Access

Both **Administrator** and **Sales Person** can create sales (spec §6) —
this is the one module a Sales Person gets real working access to. New
`customers`, `sales`, `sale_items` tables are readable/writable by both
roles, unlike Inventory/Purchases' admin-only tables.

## 2. Customer (new schema — spec §3.2)

- `customers`: name, mobile_number (lookup key), address, created_at.
- Auto-suggest by mobile number as staff types; auto-fills name/address on
  an existing match.
- No match → new customer record created automatically on save, no separate
  "Add Customer" step required.
- Customer directory (search/filter by name or mobile) and a customer's
  sale history are a byproduct of this table, not a separate module pass —
  Service will reuse this same table when it's built, not duplicate it.

## 3. Core Sale Flow (spec §4.5)

1. Enter/select Customer (see §2).
2. Add one or more Sale Items:
   - **Track Tyre:** select item, quantity only — no category/brand
     prompts (matches Inventory's existing Track Tyre singleton behavior).
   - **Brand New Tyre:** category → brand → item → quantity. Selling price
     auto-pulled from Inventory.
   - **Other items** (oil, chains, sprockets, brake components,
     accessories): select item, quantity, selling price auto-pulled.
3. Optionally add one or more Installation Charge lines (see §4) — added the
   same way as products, in the same list, typically after the products
   they relate to.
4. Optionally apply GST at the sale level.
5. Optionally apply Discount at the sale level.
6. System computes: Subtotal → + Installation Charges (sum of all line
   items') → + GST − Discount → Grand Total.
7. On completing the sale: stock auto-deducts per line item via the
   existing `adjustStock(itemId, -quantity, reason='SALE', ...)` — already
   FIFO-batch-aware, nothing new required. A Sales Invoice is generated.

## 4. Installation Charge **(changed — generalized from the PRD's tyre-only
Fitting Charge, and finalized as its own line-item type, not a per-product
toggle — confirmed after walking through how it's actually used on the
floor)**

The PRD modeled Fitting Charge as a whole-sale field (`fitting_wheel_count`
× ₹300). Confirmed final design: Installation Charge is **its own kind of
line item on the sale** — added to the same Sale Items list as products,
via the same "+ Add Item" flow, typically added last after the products
it relates to — rather than a checkbox nested inside a specific product
row. This matches how it's actually rung up: ring up the 4 products, then
add the install charge as its own line, same as it would appear on a
handwritten bill.

`sale_items` therefore has two line kinds, distinguished by a `line_type`
enum:

- **`PRODUCT`** — as described in §3: inventory_item_id, quantity, unit
  selling price, line total. Reduces stock via `adjustStock()`.
- **`INSTALLATION`** — a labour/installation charge line. Does **not**
  reference an inventory item and does **not** move stock. Two sub-types,
  chosen by staff when adding the line:
  - **Tyre Fitting** — staff enters wheel count; amount **auto-calculates**
    as `wheel_count × ₹300` (confirmed — matches "2 tyres → ₹600" from the
    original discussion), shown editable in case a one-off rate applies.
    Wheel count is independent of how many tyres were actually purchased on
    this sale (e.g. 4 bought, 2 fitted today is valid — and the tyres don't
    even need to be part of *this* sale, e.g. fitting a tyre a customer
    already owns).
  - **Other/Custom Installation** — free-text description (e.g. "Chain
    Sprocket Kit Installation") + amount **typed in manually every time** —
    confirmed no preset/suggested rate stored anywhere; not guessing at
    rates without real pricing data yet.
  - Each Installation line also gets an optional **"Installed by"** field —
    lightweight staff accountability, no scheduling, no job card.
- No `is_installable` flag needed on `inventory_items` — dropped from the
  design. Because Installation is now decoupled from any specific product
  row, staff can add one for any reason (including items not sold today),
  so a per-item catalog flag would have added complexity without adding
  capability.
- Every Installation line is itemized separately on the invoice, in the
  order it was added — never blended into product cost. Non-negotiable,
  carried over from the PRD's original fitting-charge rule.

## 5. Escalate to Service **(new — Sales↔future-Service bridge)**

- Available on any completed sale that had at least one `INSTALLATION` line.
- Flags that sale **"Needs Service Follow-up"** with an optional note,
  tied to the Customer record — does **not** create a Service Job (Service
  module doesn't exist yet).
- Scope boundary, explicit: this is a flag + note stored against the sale/
  customer, nothing more. When the Service module is built, it queries for
  flagged sales as a ready-made intake queue. Sales is not touched again to
  make this work later.

## 6. Sale Return **(new — correction mechanism, confirmed; mirrors Purchase
Return's design)**

- A completed Sale is never edited or deleted (§3 note) — a mistake (wrong
  item, wrong quantity, customer return) is corrected via a Sale Return
  against a specific `PRODUCT` line, same pattern as Purchase Return against
  a Purchase Entry.
- Increases `available_quantity` back via `adjustStock(itemId, +quantity,
  reason='SALE_RETURN', sourceModule='sales', note)` — requires adding
  `SALE_RETURN` to the `stock_movement_reason` enum (small migration,
  same shape as `PURCHASE_RETURN` before it).
- Linked to the original Sale Item (`return_of_sale_item_id`); return
  quantity can't exceed that line's original quantity minus any prior
  returns against it.
- Requires a reason/note, same rule as every other stock-decreasing/
  increasing correction in this system.
- Returning stock does **not** automatically reverse an `INSTALLATION`
  line's charge (fitting was already performed) — refunding an installation
  charge, if ever needed, is a manual separate note for now, not an
  automated part of Sale Return. Flagging as an assumption, not asking as
  an open question — cheap to revisit if wrong.

## 6a. Undo Sale Return **(new — draft, awaiting confirmation; module
workflow step 1)**

- Corrects a mis-entered Sale Return itself (wrong item picked, wrong
  quantity, entered against the wrong sale) without leaving the affected
  line's stock permanently off — mirrors why Sale Return exists in the
  first place, one level up.
- **Access:** Admin-only, same tier as Sale Return itself (`adjust_stock`'s
  `SALE_RETURN` reason is already admin-gated) — reusing that same
  authorization rather than inventing a new one.
- **Trigger UI:** the existing Return dialog (opened from the same
  `RotateCcw` action in the Sales table) gains a small list of that sale's
  existing returns underneath the "new return" form, each with its own
  "Undo" action — no new page/route needed.
- **Reason required:** yes, same convention as every other stock-correcting
  action in this system (Purchase Return, Sale Return, manual corrections
  all require one).
- **Data model — confirmed:** undoing **deletes** the `sale_returns` row
  (not a soft-void flag). `returnedQuantity` sums (Sales list badge, Return
  dialog's remaining-quantity check) then reflect reality automatically,
  no extra filtering needed anywhere. The correction is still permanently
  auditable via `stock_movements` — every adjustment there (the original
  restock *and* the undo's reversal) is an immutable, timestamped,
  reason-carrying row; nothing is actually lost by removing the
  `sale_returns` row itself.
- **Stock reversal mechanics:** calls the existing `adjust_stock(item_id,
  -quantity, reason='SALE_RETURN', sourceModule='sales', note=<undo
  reason>)` — negative delta, same reason code (already admin-gated +
  note-required), consumed via the standard FIFO path like a normal sale
  decrement. No new stock logic, no `adjust_stock` signature change.
- **Edge case — stock already moved on:** if some/all of the originally
  -returned units were resold or used elsewhere before the undo happens,
  there may not be enough stock left to reverse. `adjust_stock` already
  raises its standard insufficient-stock error in that case (same
  `InsufficientStockError` used everywhere else) — the undo is simply
  blocked with that message, no special-case handling needed.
- **Scope:** targets one specific `sale_returns` record (if a line had two
  separate returns entered on different days, each is undoable
  independently) — not an "undo all returns for this sale" bulk action.
- **New backend piece needed:** a `undo_sale_return(p_sale_return_id,
  p_reason)` DB function — locks the `sale_returns` row (and its source
  `sale_items` row) `FOR UPDATE`, reverses stock via `adjust_stock` as
  above, then deletes the row, all atomically (same transactional shape as
  `record_sale_return`).
- **Non-goals:** no time limit on when a return can be undone; no bulk
  undo; does not touch `INSTALLATION` lines (Sale Return never did either).

## 7. Invoice (spec §4.10, §7)

- Sales Invoice: line items (product, qty, unit price, line total),
  Installation Charges section (itemized per line, not lumped), GST
  (optional), Discount (optional), Grand Total.
- Sequential invoice numbering: `TW-S-000123` (Sales prefix, distinct from
  Service's future `TW-J-000123`).
- Printable/PDF-ready, same pattern Purchases already established for its
  own documents.

## 8. Validation Rules

- `customerMobileNumber`: required, used as the lookup/create key.
- A sale requires at least one `PRODUCT` line — blocked explicitly at the
  schema level rather than left to chance; an `INSTALLATION`-only sale
  isn't a valid transaction (nothing was actually sold).
- `PRODUCT` line: `quantity` required positive integer; can't exceed
  available stock — reuses `adjustStock()`'s existing insufficient-stock
  guard, no new check needed.
- `INSTALLATION` line, Tyre Fitting sub-type: `wheelCount` required positive
  integer; `amount` auto-computed but stored/editable, must stay ≥ 0.
- `INSTALLATION` line, Other/Custom sub-type: `description` required
  non-empty text; `amount` required, must be ≥ 0.
- GST/Discount: both optional, same convention as every other invoice in
  this system.

## 9. Dashboard / Reports data contract (not building those modules now, but
Sales must expose this cleanly for when we do)

- `getSalesStats(dateRange)` → aggregate Sales Amount, feeding the
  Dashboard's `Profit = Sales Amount − Purchase Amount` and the
  current-month Sales Amount figure (spec §4.2).
- Sales Report's fields (date range, item, customer, quantity, revenue,
  fitting/installation charges) are all covered by `sales`/`sale_items`
  above.
- Stock Movement Report is already fed automatically via `adjustStock()` —
  Sale line items land in `stock_movements` the same way Purchase entries
  do, reason `SALE`.

## 10. UI/Component Reuse

- Item picker: same active-item combobox pattern from Inventory/Purchases
  (search by name/SKU), reused per line-item type (Track Tyre / Brand New
  Tyre / Other).
- Customer field: mobile-number-driven combobox with auto-suggest/auto-fill,
  new component but follows the same Combobox conventions already fixed
  (inline dropdown, not portal-based — see prior Combobox bug fix) and the
  established "every field clears its own validation error on change" rule.
- List screen: same filter bar + paginated table + stats cards + skeleton
  loading + empty state as Inventory/Purchases.
- **New Sale: dedicated page** (`/sales/new`), not a modal — confirmed
  default given the design above: a sale is a running list mixing product
  lines and installation lines, plus customer, GST, discount, and a live
  running total. That's meaningfully more on-screen than Record Purchase's
  single-item modal; a full page gives it room without feeling cramped.
  react-hook-form + zod (array field for line items), same
  validation-message conventions as elsewhere.
- Toasts (sonner) for success/error — same as Inventory/Purchases.
- `app/(app)/sales/actions.ts` Server Actions calling `services/sales/*` —
  same layering as Inventory/Purchases; no direct Supabase calls from
  components.

## 11. Access & RLS

- New `customers`, `sales`, `sale_items` tables: RLS allows both `admin`
  and `sales_person` roles to read/write — first module where Sales Person
  needs real write access (mirrors the role matrix already fixed in
  `app/(app)/layout.tsx` / `requireAdmin()`'s sibling, a lighter
  `requireSalesAccess`-style guard rather than admin-only).
- `adjust_stock()`: no change needed for `SALE` — already a valid reason in
  the enum and already handled by the existing function.

## 12. Confirmed Decisions Log

- Installation Charge is its own `INSTALLATION` line-item kind, added to
  the same Sale Items list as products, not nested per-product (§4).
- Tyre Fitting sub-type auto-calculates `wheel_count × ₹300`; every other
  installation is typed in manually (§4).
- Sales are immutable once completed — corrected via Sale Return, same
  precedent as Purchase Entries (§3 note).
- New Sale is a dedicated page, not a modal (§9).
