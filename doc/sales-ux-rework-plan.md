# Sales Screen — UX / Flow Rework Plan

**Status:** Proposal, awaiting confirmation (module workflow step 1).
**Scope:** Layout and flow of **New Sale**, plus finally surfacing combos here.
No change to how stock deducts, how invoices are numbered, or who can access
what. One genuinely new behaviour is proposed (the fitting prompt, §3.C) and
it's flagged as such.

---

## 1. What the New Sale screen does today

One column, four stacked blocks:

1. **Customer Details** — name and mobile both offer suggestions; picking
   either fills all three fields.
2. **Sale Items** — two buttons, *Add Product* and *Add Installation Charge*.
   Each adds an empty row. A product row gets a search-by-name/SKU combobox;
   an installation row gets a subtype dropdown (Tyre Fitting / Custom).
3. **Charges & Totals** — GST (prefilled 18%) and Discount, both optional,
   with Subtotal and Grand Total.
4. **Cancel / Complete Sale** at the very bottom.

Things already working well, which this plan keeps untouched:

- The **−/+ quantity stepper**, clamped to available stock, so you can't
  oversell by typing.
- **GST prefilled at 18%**, editable as a rate.
- The invoice **auto-prints** on completion — no extra click.
- Tyre fitting **auto-calculates** `wheels × ₹300`, with an override for a
  one-off rate.

## 2. What a normal sale costs today

Selling a front and rear tyre with fitting — the shop's bread-and-butter:

| # | Action |
|---|--------|
| 1 | Sales → New Sale |
| 2 | Type mobile (name and address auto-fill — good) |
| 3 | Click **Add Product** |
| 4 | Open the combobox, search the front tyre, select |
| 5 | Set quantity |
| 6 | Click **Add Product** again |
| 7 | Search the rear tyre, select |
| 8 | Set quantity |
| 9 | Click **Add Installation Charge** |
| 10 | Open the subtype dropdown, pick *Tyre Fitting* |
| 11 | Set wheel count |
| 12 | Scroll down, click **Complete Sale** |

≈ **12–15 interactions**, and step 9 is the one most likely to be skipped
under pressure — see §3.C.

## 3. Gaps

### Gap 1 — The same "pick a type, then hunt a dropdown" pattern Service just lost

*Add Product* vs *Add Installation Charge* makes the admin classify the line
before they've said what it is. The Service form removed exactly this: one
search box, type, press Enter, and the system works out what it became.
Sales should get the identical component, not a parallel one.

### Gap 2 — Combos exist but are invisible here ⚠

`sale_items` carries a `COMBO` line type, `record_sale()` expands a combo
server-side, and the shared `services/combos/` layer is built and tested —
but the Sales form has no way to add one. A combo built in Manage Catalog is
sellable from a Service Job and nowhere else. This is finishing confirmed
work, not new scope.

### Gap 3 — Fitting is manual, and forgetting it costs real money 💰

Nothing connects "there are tyres on this sale" to "there should be a fitting
charge". Sell two tyres, forget step 9, and ₹600 walks out of the door with no
warning — on the busiest transaction the shop does. Over a month that's a
meaningful number, and it's invisible because the invoice looks perfectly
normal without it.

The inverse is also unguarded: if the sale is a **combo** that already covers
fitting, adding a fitting line double-charges the customer (test case #76a).

### Gap 4 — One column wastes the screen

Same problem the Service form had. The totals and **Complete Sale** sit below
the fold on a wide monitor while the right half of the screen is empty.

### Gap 5 — No quick-add for fast movers

A tyre shop sells the same handful of tyres all day. Every one of them is
currently a full search.

### Gap 6 — Small things at the top

"Invoice No. — *assigned on save*" is a non-actionable placeholder occupying
prime top-right space, next to a date that's almost always today.

### Gap 7 — No payment record

Service now captures whether the customer paid. Sales captures nothing, so
there's no way to tell a settled invoice from an unpaid one. That may be
correct for a cash-and-carry counter — flagging it as a question, not
assuming it's a defect.

---

## 4. The plan

The guiding rule: **Sales and Service should feel like the same application.**
Every piece below reuses what the Service rework already built rather than
growing a second set of near-identical components.

### A. One unified picker

Promote `ServiceLinePicker` into a shared component and use it on both
screens. On Sales it searches across:

- **Inventory items** → a product line
- **Combo offers** → a combo line (Gap 2)
- **Tyre fitting** → an installation line, wheel count pre-filled from the
  tyres already on the sale
- **Anything else typed** → a custom installation charge

Both *Add …* buttons disappear. Above the box, **quick-add chips for the
fastest-moving items**, ranked from real sales history — the same
`frequent.ts` approach already ranking services, pointed at `sale_items`.

### B. Combos in Sales

A combo appears as a chip and in search, adds one priced line, and its
included products come in at ₹0 tagged "in combo". The server already does the
expansion, so this is UI plus an action.

### C. The fitting prompt — the one behaviour change

When a sale contains tyres and has no fitting line, an inline prompt appears
under the item list:

> **2 tyres, no fitting charge.** Add tyre fitting — ₹600? **[Add]** **[Not needed]**

Non-blocking and dismissible: a customer collecting tyres to fit elsewhere is
a real case, and blocking the sale would be worse than the problem. Dismissing
is remembered for that sale only.

And the inverse, when a combo already covers it:

> This combo already includes fitting — adding a separate charge will bill it twice.

**⚠ This is the one genuinely new behaviour in the plan and needs your yes.**

### D. Two-column layout

Same shape as the reworked Service form:

- **Left:** Customer Details → Sale Items
- **Right, sticky:** Charges & Totals → Complete Sale → Cancel

The running total and the primary button stay on screen while you add items.
No scrolling to finish a sale.

### E. Smaller fixes

- Drop the "assigned on save" placeholder; keep the date as a compact control.
- Replace the pre-seeded empty row with a real empty state — an untouched
  form shouldn't open looking like a half-filled one.
- Keep the quantity stepper, the stock clamp, GST at 18%, and auto-print
  exactly as they are.

---

## 5. Before / after

| Task | Today | After |
|---|---|---|
| Two tyres + fitting | 12–15 interactions | 4–5 (chip, chip, accept the fitting prompt, Complete) |
| Sell a combo | Not possible | One chip |
| Forgetting the fitting charge | Silent, costs ₹600 | Prompted before you can finish |
| Reaching Complete Sale | Scroll past everything | Always on screen |

---

## 6. Confirmed decisions

1. **The fitting prompt is a non-blocking nudge.** It appears, it can be
   dismissed for that sale, and it never stops a Complete Sale.
2. **Payment is captured, and "Customer has paid" is ticked by default** — a
   counter sale is settled on the spot far more often than not.
3. **The Sales picker does not offer Service packages.** Modules stay
   distinct; combos are the deliberate exception because they span both.
4. Build order as proposed: A + B, then C, D, E.

## 7. Build status — complete

### Migration (⚠ needs applying to the live Supabase project)

**`0024_sale_payment_status.sql`** — `sales.payment_status` (PENDING /
PARTIAL / PAID), `record_sale()` accepting it, and `update_sales_payment_status()`
for settling an invoice later.

**⚠ Backfill assumption:** every existing sale is marked PAID. They're
historical counter sales from before the concept existed and the shop was cash
on collection throughout. If any past invoice is genuinely unpaid, it needs
correcting by hand.

### New modules — `services/sales/`

- **`picker.ts`** — one index over items, combos and a synthetic "Tyre
  Fitting" entry, with search, ranking and resolution. 29 tests.
- **`fitting.ts`** — the nudge, and its inverse double-charge guard. 25 tests.
- **`frequent.ts`** — how often each item and combo actually sells, ranking
  results and filling the chips. Counts rows not units, and skips products the
  server expanded out of a combo. 7 tests.

### UI

- `SaleLinePicker` — one search box plus quick-add chips, replacing *Add
  Product* and *Add Installation Charge*.
- Two-column layout with totals, the payment box and **Complete Sale** pinned
  on the right.
- Combos sell from here, rendered as one priced line with unpriced contents.
- The fitting nudge, and the "this combo already includes fitting" warning.
- The sales invoice now prints combo contents, "You saved ₹X", and stamps
  **Payment pending** on an unsettled invoice.

### Asymmetry worth remembering

Service expands a combo **client-side** (a job stays editable). Sales expands
it **server-side** in `record_sale()` — a sale is one shot and never edited, so
the client sends only the combo id and quantity and can't mis-state the bundle
or skip a deduction.

### Fixed along the way

The uuid-fixture rot in `services/sales` and `services/online-orders` — the
same placeholder-id issue already fixed in `services/service`. **The full
suite is green for the first time: 987 tests.**

### Not done

Reports don't break out combo revenue vs list value, and the Sales list has no
payment-status column or filter yet — the data is there, nothing surfaces it.
