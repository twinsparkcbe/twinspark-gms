# Payment Split (Cash / UPI) — Sales & Service

Feature & use-case list. Step 1 of the module workflow — confirmed before
test cases, test cases confirmed before implementation.

## 0. Why

Sales records **whether** money was collected (one "Customer has paid" tick →
`payment_status` PAID or PENDING) but nothing about **how**. A ₹2,000 bill
settled as ₹1,000 UPI + ₹1,000 cash is indistinguishable from ₹2,000 cash, so
the cash box can't be reconciled against the bank at end of day.

Two further gaps this closes:

- `PARTIAL` exists in the `sales_payment_status_check` constraint (0024) but
  no screen can produce it — the form only offers a boolean.
- `update_sales_payment_status()` was written in 0024 and is wired to no UI,
  so a PENDING sale can never be settled from the app.

Service (0016) has the same shape and is included in this pass.

## 1. Data model — migration `0027_payment_split.sql`

Three columns on **both** `sales` and `service_jobs`:

| Column | Type | Notes |
|---|---|---|
| `payment_mode` | `text null` | `CASH` \| `UPI` \| `SPLIT`. Null = not recorded. |
| `cash_amount` | `numeric not null default 0` | `check (cash_amount >= 0)` |
| `upi_amount` | `numeric not null default 0` | `check (upi_amount >= 0)` |

**`payment_status` becomes derived, not passed.** Computed server-side after
`grand_total` is known:

```
paid = cash_amount + upi_amount
paid = 0             → PENDING
paid >= grand_total  → PAID
otherwise            → PARTIAL
```

This is the point of the change: status and amounts can no longer disagree,
and `PARTIAL` finally becomes reachable. `FREE_SERVICE` (Service only) stays
an explicit override — mode null, amounts 0, status `FREE_SERVICE` — never
derived, since ₹0 collected on a warranty job is not the same fact as ₹0
collected on an unpaid one.

**Backfill: none.** Existing rows get `payment_mode = null`, amounts 0, and
keep their stored `payment_status` untouched. A historic PAID sale therefore
reads as "paid, mode unrecorded" — which is the truth. Reports surface these
in their own `Unrecorded` bucket rather than guessing cash (§8).

**Function changes:**

- `record_sale_with_payment(...)` — **new wrapper**, the only path the app
  calls. It invokes the existing `record_sale()` and applies the payment in
  the same transaction. *Deviation from the original plan*, which was to
  re-emit `record_sale()` with new parameters: its 300-line body has already
  been copied verbatim three times (0022 combos, 0024 payment status, 0026
  role helpers) and each copy is a chance to silently drop a fix. A wrapper
  is atomic all the same — if the payment step raises, the sale, its lines
  and every stock deduction roll back together — without a fourth copy to
  keep in sync. `record_sale()` itself is untouched.
- `update_sales_payment_status(p_sale_id, p_payment_mode, p_cash_amount,
  p_upi_amount)` — replaces the old `(uuid, text)` signature, which is
  dropped. Leaving both would let a caller set a status directly and
  reintroduce the status/amount disagreement this change exists to remove.
- `update_service_payment_status(...)` — same replacement, plus a
  `p_free_service boolean` for the `FREE_SERVICE` override. Admin-only guard
  and the COMPLETED-only rule carry over unchanged from 0016/0026.
- `derive_payment_status()` / `derive_payment_mode()` — small immutable SQL
  helpers, the server-side mirror of `services/shared/payment.ts`.

⚠️ **This migration must be applied to the live Supabase project** before the
new build is deployed — the RPC signature change is breaking.

## 2. Shared payment control

One component, `components/shared/payment-capture.tsx`, used by both modules —
no per-module copy (project rule: single shared component set).

```
PaymentCapture({
  grandTotal: number
  value: { mode, cashAmount, upiAmount, freeService }
  onChange: (next) => void
  allowFreeService?: boolean   // Service only
  errors?: { cash?: string; upi?: string }
})
```

Options, as a radio-card row:

| Option | Cash | UPI | Derived status |
|---|---|---|---|
| Full — Cash | Grand Total | 0 | PAID |
| Full — UPI | 0 | Grand Total | PAID |
| Split (Cash + UPI) | see §3 | typed | PAID or PARTIAL |
| Not paid yet | 0 | 0 | PENDING |
| Free service *(Service only)* | 0 | 0 | FREE_SERVICE |

Default selection stays **Full — Cash**, matching the current pre-ticked
"Customer has paid" behaviour — a counter sale is settled on the spot far
more often than not.

## 3. Split mode — the auto-fill rule

Two amount inputs. The rule has to let the counter person start from either
field *and* still allow a balance to be left owing, so:

- Cash and UPI each track a **pristine** flag.
- Editing one field auto-fills the other **only while that other field is
  still pristine**, with `max(0, grandTotal − thisField)`.
- Once a field has been typed into, it is manual and never overwritten again.
- Each field carries a small **Fill balance** link to re-derive it on demand.

Worked example (₹2,000 bill): type `1000` in UPI → Cash auto-fills `1000`,
balance ₹0. Overwrite Cash with `500` → Cash is now manual, UPI stays
`1000`, and a **Balance due ₹500** warning appears; the sale saves as
`PARTIAL`. Further UPI edits no longer clobber the ₹500.

`Cash + UPI` under the total is allowed and shows the balance-due warning.
Over the total is a validation error — there is no change-given or tip
concept at this counter.

## 4. Recalculation when the total moves

Grand Total changes whenever lines, GST or discount change. On every change:

- **Full — Cash / Full — UPI** → the single amount snaps to the new total.
- **Split** → the manual field(s) are kept, pristine fields re-derive. If the
  new total is lower than what's already entered, amounts are clamped down
  and the balance-due line recomputes.
- **Not paid yet / Free service** → unaffected.

Without this, editing a line after choosing payment leaves a ₹2,000 payment
recorded against a ₹2,500 bill.

## 5. Settling later — Record Payment

Now that `PARTIAL` is reachable, an unpaid or part-paid bill needs a way to be
collected later. A **Record Payment** dialog, opened from the Sales row
actions and the Sales detail screen, reusing the same `PaymentCapture`
control pre-filled with what's already been collected. Writes via
`update_sales_payment_status`.

Service already has a payment control on its detail screen (a bare status
`Select`) and a **Mark Paid** row action — both are replaced by this same
dialog, so a job can't be flipped to PAID without saying how.

**Single-shot, not a ledger.** Recording payment *overwrites* the cash/UPI
figures rather than appending an instalment row. A running payment history
per invoice is a non-goal (§11) — the shop settles a bill in at most two
touches.

## 6. Invoice display

Under Grand Total on both `SalesInvoiceView` and `ServiceInvoiceView`, inside
the existing boxed totals panel:

```
Paid by          Cash ₹1,000 · UPI ₹1,000
Balance due                        ₹500      ← only when PARTIAL
```

Rendered only when `payment_mode` is set — historic invoices print exactly as
they do today. The existing "Payment pending" / "Part payment received" badge
is unchanged. Built into the view model (`InvoiceTotalsView`) as pre-formatted
labels, consistent with how every other figure on that document already
works — no formatting logic in the component.

## 7. Sales list column

A **Paid** column between Amount and Actions, showing a chip:

- `Cash` / `UPI` / `Split` — neutral chip, for settled bills
- `Partial` — warning chip, with the balance in its tooltip
- `Pending` — danger chip
- `—` for historic rows with no mode recorded

Row grid widens from
`[100px_minmax(160px,220px)_130px_minmax(200px,320px)_130px_140px]` to add a
`110px` track; the mobile card layout gains a matching "Paid" row. (The
existing comment in `sales-table.tsx` about column widths applies — the
labelled cells need checking at the narrow breakpoint.)

## 8. Reports — Collections (Cash vs UPI)

New report at `/reports/collections`, service in
`services/reports/collections.ts`, following the existing report conventions
(`report-card`, `use-report-date-range`, `download-xlsx-button`).

For a chosen date range, across Sales + **completed** Service jobs:

| Figure | Definition |
|---|---|
| Cash collected | `sum(cash_amount)` |
| UPI collected | `sum(upi_amount)` |
| Unrecorded | `sum(grand_total)` where status is PAID but `payment_mode is null` — historic rows |
| Outstanding | `sum(grand_total − cash − upi)` where status is PENDING or PARTIAL |
| Total billed | `sum(grand_total)` |

Shown as summary cards plus a per-day breakdown table (Date, Cash, UPI,
Outstanding), XLSX download like the other reports. `Unrecorded` is a
deliberate, visible bucket — it shrinks to zero on its own as old invoices
age out of the reporting window, and never silently inflates the cash figure.

Excludes Online Orders, matching the existing scope note that keeps Revenue
and Profit consistent across screens.

## 9. Validation rules

Client-side **and** in the RPC (the authoritative total is only known
server-side once lines are priced):

1. `cash_amount >= 0`, `upi_amount >= 0`.
2. `cash_amount + upi_amount <= grand_total`.
3. `payment_mode` must be one of `CASH`, `UPI`, `SPLIT`, or null.
4. Mode/amount coherence, normalised rather than rejected on submit:
   `SPLIT` with one side zero is stored as the corresponding single mode —
   the counter person shouldn't get an error for a technicality.
5. `CASH` implies `upi_amount = 0`; `UPI` implies `cash_amount = 0`.
6. Service: `FREE_SERVICE` forces mode null and both amounts 0.

## 10. Edge cases

- **Grand Total ₹0** (fully discounted sale) — every mode resolves to amounts
  0 and status PAID, not PENDING. Special-cased in the derivation.
- **Sale return after payment** — returns do not adjust `cash_amount` /
  `upi_amount`. A refund is a cash movement the app doesn't model today;
  flagged, not silently handled (§11).
- **Historic row edited** — settling an old sale through Record Payment sets
  a mode, moving it out of the Unrecorded bucket. Expected.
- **Free service switched back to paid** — clearing `FREE_SERVICE` requires
  choosing a mode; status re-derives from the amounts entered.
- **Total drops below amount already collected** — amounts clamp to the new
  total rather than producing an over-payment error the user can't act on.
- **Concurrent settle** — last write wins; no optimistic locking, consistent
  with how every other status update in the app behaves.

## 11. Non-goals

- Card, cheque, bank transfer or wallet as separate modes — cash and UPI are
  what this counter takes.
- A payment history / instalment ledger per invoice (§5).
- Refunds against a return adjusting collected amounts (§10).
- Online Orders — it has its own payment-verification flow.
- Dashboard tiles for cash vs UPI — Reports only for this pass.
