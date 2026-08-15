# FIFO Batch Tracking — Feature & Use-Case List

**Status:** Confirmed for build (module workflow step 1). Extends
`purchase-module-scope.md` §2 (Record Purchase) and touches the
already-shipped Inventory module's stock ledger.

**Why:** exposed by a real scenario — 50 Track Tyres bought at ₹1,000, then
more bought at ₹900. A single "current cost" number can't represent stock
bought at different prices; FIFO batches with a real remaining quantity and
cost each can.

---

## 1. Core Concept

Every Purchase Entry becomes a **batch** — an auto-numbered lot with its own
remaining quantity and cost, consumed oldest-first when stock goes out
(Sale, Service usage, Online Order dispatch, Damage, Manual Correction,
Purchase Return).

- `purchase_entries` gains: `batch_number` (auto-generated, human-readable —
  e.g. `BATCH-000001`, via a DB sequence function mirroring the existing
  `next_inventory_sku()` pattern) and `remaining_quantity` (starts equal to
  `quantity`, decreases as the batch is drawn from).
- `inventory_items.available_quantity` stays as a fast-read cached total
  (still used by filtering/sorting/low-stock alerts), but is no longer the
  source of truth — it's kept in sync transactionally with the batches'
  `remaining_quantity` totals inside the same DB function that touches them.

## 2. Consuming Stock (FIFO)

- Any stock decrease pulls from batches for that item ordered by
  `purchase_date asc` (oldest first), draining one batch's
  `remaining_quantity` before moving to the next.
- If a single event (e.g. one Sale) exceeds what's left in the oldest batch,
  it splits across two or more batches automatically — no manual picking.
  Each batch touched gets its own `stock_movements` row (a new
  `purchase_entry_id` column links each movement to the batch it came
  from/went to), so a 60-unit sale against a 50-remaining + 10-remaining
  batch pair produces two ledger rows, not one.
- **Purchase Return is the one exception** — it already targets one specific
  batch explicitly (the purchase being returned against), not FIFO. That
  part of the existing design doesn't change; it now also decrements that
  batch's `remaining_quantity`, not just `available_quantity`.

## 3. Stock Increases That Aren't a Real Purchase **(new — the open question
from the last message, now resolved)**

Opening Stock (entered on Add Item) and a positive Manual Correction (a
stock-take finds *more* physical stock than the system shows) don't come
from a real supplier purchase, but every unit needs a cost to stay
FIFO-consistent — otherwise some stock has a real cost basis and some
doesn't, which breaks Inventory Value and any future Profit/COGS reporting.

- **Opening Stock** → automatically creates a synthetic batch behind the
  scenes, priced at whatever `purchase_price` was typed into the Add Item
  form, noted "Opening Stock" instead of a supplier name.
- **Manual Correction (increase only)** → same treatment: creates a
  synthetic batch. The Adjust Stock dialog gains one new field —
  **Cost per Unit** — shown only when the adjustment is positive.
  **Optional**: if left blank, automatically falls back to the item's most
  recently purchased batch's cost (confirmed — favors speed for a quick
  stock-take fix over forcing an exact figure every time).
- **Manual Correction (decrease) and Damage/Write-off** → no new batch
  needed; these just consume FIFO from existing batches like a sale, at
  zero revenue (unchanged from today, just batch-aware now).

## 4. Inventory Module Impact (already shipped — this is a real change to it)

- **Inventory Value stat**: today `purchase_price × available_quantity`.
  Becomes `sum(remaining_quantity × unit_price)` across all of an item's
  batches — the actual point of this change; correctly reflects tyres
  bought at ₹1,000 and ₹900 as two different cost pools instead of one
  blended or overwritten number.
- **Inventory item's `purchase_price` field**: stops being "the current
  cost" (that idea goes away entirely, replaced by batch-level costs) and
  becomes purely a *reference/suggested* price shown on the item form —
  still editable, still the default pre-fill on the next Purchase Entry,
  but no longer authoritative for valuation.
- **Adjust Stock dialog**: gains the Cost per Unit field described in §3 for
  positive adjustments.

## 5. Batch Visibility (UI)

- Purchase History table gains a **Batch #** column.
- **(new)** A "Batches" view per item (accessible from the item, or from a
  Purchase Entry) showing every batch with its original quantity, remaining
  quantity, cost, and date — e.g. "BATCH-000041: 50 purchased, 12
  remaining, ₹1,000/unit" and "BATCH-000058: 30 purchased, 30 remaining,
  ₹900/unit."
- Stock Movement entries (Reports, future) show which batch they drew from,
  so "sold 15 units" traces back to exactly which purchase(s) it came out
  of.

## 6. Validation & Edge Cases

- A batch can't go negative — same race-safe guard pattern as today's
  `adjust_stock()` (re-check remaining quantity in the same statement that
  decrements it).
- If total FIFO consumption requested exceeds the sum of all remaining
  batches for an item, the whole operation fails (same "insufficient stock"
  error as today) — never partially consumes then fails.
- Deactivating/deleting an item with any batch still holding
  `remaining_quantity > 0` follows the existing Inventory rule (history
  exists → deactivate, not delete).

## 7. What Doesn't Change

- The single shared `adjustStock()`/`adjust_stock()` entry point stays the
  *only* way anything mutates stock — this change happens inside that
  function, not by adding new call sites elsewhere.
- Every module built after this (Sales, Service, Online Orders) gets FIFO
  batch consumption for free just by calling the same function — no
  per-module batch logic needed.
- Purchase Return's existing "target one specific batch" design is already
  correct and doesn't need to change.
