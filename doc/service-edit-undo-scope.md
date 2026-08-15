# Service — Edit Completed Job & Undo Completion (scope)

Confirmed feature & use-case list. Implemented 15 Aug 2026 — migration `0028_service_edit_undo.sql`.

Trigger: on the Service list the two action icons read as duplicates (they are actually Job Card vs
Invoice — both open a print preview), and a completed job is a dead end: `update_service_job()`
refuses anything past `IN_PROGRESS`, so a wrong quantity or rate can never be corrected.

---

## 1. Problem being solved

A garage-floor mistake is discovered *after* the job was completed and billed:

- wrong part picked, or wrong quantity of a part
- wrong service / rate / labour charge
- GST or discount applied when it shouldn't have been (or missed)
- wrong customer or vehicle attached
- job completed against the wrong bike entirely

Today the only recovery is creating a second job, which double-counts stock and revenue.

Two separate recoveries, deliberately different:

| | **Edit Completed Job** | **Undo Completion** |
|---|---|---|
| Use when | Details were wrong, the job itself was real | The whole completion was a mistake / needs re-doing from scratch |
| Job status after | Stays `COMPLETED` | Back to `IN_PROGRESS` |
| Invoice number | **Same number kept** | **Cleared** — re-completing draws a fresh number (gap in series is accepted) |
| Stock | Reconciled to the corrected parts list | Fully restored |
| Payment | Amounts kept, status re-derived against the new total | Cleared to nil |
| Who | Administrator only | Administrator only |
| After save | Lands on the invoice print view | Lands on the job, ready to re-bill |

On a job that was never billed (Draft / In Progress / Ready) there is nothing to reverse — no stock
moved, no invoice exists — so the same Undo affordance means **Cancel the job**: the existing
`CANCELLED` transition, with a reason attached. One button, one meaning per state.

---

## 2. Edit Completed Job

**Entry:** pencil icon on the Service list row + a button on the job detail page → existing
`/service/[id]/edit` screen, which already renders the full form (services, parts, GST, discount,
customer/vehicle, mechanic).

**Who:** Administrator only when the job is `COMPLETED`. `DRAFT`/`IN_PROGRESS` editing keeps today's
rule (anyone with service access, incl. Mechanic) — unchanged.

**What can change:** everything the form already exposes — service lines, parts used and their
quantities, rates, GST, discount, customer, vehicle, odometer, notes, assigned mechanic. Plus the
payment tender (cash/UPI split), so a bill corrected upward can be re-collected in the same pass.

**Stock reconciliation:** the corrected parts list is applied by reversing the job's existing
deduction and re-deducting the new one inside one transaction. A quantity typed as 4 instead of 2
puts 2 back. Removing a part entirely restores all of it. Adding a part deducts it, and fails the
whole edit if there isn't enough stock — the job is left exactly as it was.

**What is preserved:** `invoice_number`, `completed_at`, `delivery_status`, and the recorded
cash/UPI amounts.

**What is recomputed:** subtotal, inventory total, grand total, and `payment_status` — derived from
amounts against the new total, per the existing rule. Correcting ₹5,600 up to ₹5,900 on a job where
₹5,600 was collected flips it to `PARTIAL` automatically; correcting downward to ₹5,000 flips it to
`PAID` (₹600 over-collected is shown, not hidden).

**Audit:** a `JOB_EDITED` event on the job timeline recording who, when, and the grand-total
before → after. Every stock movement lands in `stock_movements` as normal.

**On save:** redirect to `/service/[id]/invoice` so the corrected bill can be handed over
immediately.

### Edge cases
- No parts changed → no stock movements written at all (not a reverse-and-redo of the same numbers).
- Insufficient stock for an added/increased part → whole edit rejected with the standard message,
  nothing changes.
- Job already delivered → allowed, with a warning in the confirm step.
- Job already paid → allowed; if the total moves, the payment status follows and the difference is
  stated on screen before saving.
- Removing every service line → rejected (a completed job must keep ≥1 line).

---

## 3. Undo Completion

**Entry:** undo icon on the Service list row (completed jobs only) + a button on the job detail page.
Opens a confirmation dialog — never a one-tap action.

**Who:** Administrator only.

**Dialog states plainly, before confirming:**
- the parts that will go back into stock, with quantities
- that invoice `TW-J-00000N` will be voided and re-completing issues a **new** number
- if paid: "₹X already recorded as collected will be cleared"
- if delivered: "This job was already marked delivered"
- a **required reason** (free text), same as Undo Sale Return

**Effect (single transaction):**
- every deducted part restored to stock (reason `SERVICE_USAGE`, source `service`)
- status → `IN_PROGRESS`
- `invoice_number` → null, `completed_at` → null
- `payment_mode`/`cash_amount`/`upi_amount` → cleared, `payment_status` → null
- `delivery_status` → null, `delivered_at` → null
  (null, not `PENDING`/`WAITING`: 0016's schema is explicit that both are null until `COMPLETED`, and
  an In Progress job sitting at "payment pending" would show on the outstanding-money list with no
  invoice behind it)
- `JOB_UNCOMPLETED` event logged with the reason

**After undo:** the job is editable again through the normal In Progress flow, and completing it runs
`complete_service_job()` unchanged — fresh invoice number, stock deducted again.

### Edge cases
- Undo twice / concurrent undo → row is locked; the second attempt errors cleanly.
- Job not `COMPLETED` → action isn't offered, and is rejected server-side too.
- Restored stock uses the same synthetic-batch approach Sale Return already uses (last known cost),
  rather than reconstructing the exact FIFO batches drawn from.

---

## 4. Row actions cleanup (the reported bug)

The Actions column currently shows Job Card and Invoice as two unlabelled grey icons. Proposal:

| Job status | Icons shown (left → right, after the next-step button) |
|---|---|
| Draft / In Progress / Ready | **Job Card** (printer), **Edit** (pencil), **Cancel** (rotate-left) |
| Completed | **Invoice** (receipt), **Edit** (pencil), **Undo** (rotate-left) |
| Cancelled | **Job Card** (printer) only |

Rationale: the job card is the workshop work-order and the invoice is the customer bill — they're
never both the relevant document at the same time, so showing one per state removes the ambiguity at
its source rather than papering over it with tooltips. Every icon gets a `title` tooltip and an
`aria-label` regardless. Job Card stays reachable on the detail page for a completed job.

Mobile card list mirrors the same set, with text labels (it already renders labels, not bare icons).

Undo/Cancel is icon-only in the list but always goes through the confirmation dialog, so a misclick
costs one dismiss.

All four surfaces — desktop row, mobile card, detail header, and the `/service/[id]/edit` route
guard — derive from one pure function, `getRowActions()` in `services/service/row-actions.ts`. That
is what makes it impossible for a visible Edit icon to lead to a redirect, and its unit test asserts
every offered action carries a distinct label, which is the regression guard for the original
"both buttons do the same thing" report.

---

## 5. Out of scope

- Editing or undoing a `CANCELLED` job
- Partial undo (reversing one part but not the rest) — use Edit for that
- Credit notes / negative invoices — the invoice is corrected or voided, never offset
- Any change to Sales-side undo behaviour

---

## 6. Database changes (migration `0028`)

- extend the `service_job_events.event_type` check constraint with `JOB_EDITED`, `JOB_UNCOMPLETED`
- `restore_service_job_stock()` / `deduct_service_job_stock()` — internal helpers, execute revoked
  from `public` (they carry no authorization of their own; exposing the restore one would hand a
  Mechanic an unaudited way to inflate stock)
- `undo_service_completion(p_service_job_id uuid, p_reason text)` — admin-gated, locking, restores
  stock and resets the job
- `edit_completed_service_job(...)` — admin-gated wrapper that reverses the current deduction, calls
  the existing `replace_service_job_lines()` / `recompute_service_job_totals()`, re-deducts, and
  re-derives payment status while preserving the invoice number

Both are wrappers over existing functions rather than re-emitted copies, per the
`record_sale_with_payment()` precedent.

**Both `0027_payment_split.sql` and `0028_service_edit_undo.sql` must be applied to the live
Supabase project before any of this is testable.** 0027 is what the current
`column service_jobs.payment_mode does not exist` error is about; 0028 is this feature.

Verification performed before handover: migrations 0001→0028 were replayed into a throwaway
PostgreSQL 16 instance behind a small `auth`/`storage` shim, and both new functions were driven end
to end against it — stock restored and re-deducted, invoice number kept vs. voided, payment status
re-derived, over-collection and insufficient-stock paths rolled back whole, non-admin callers
refused.
