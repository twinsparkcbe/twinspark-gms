# Online Orders — customer-quoted amount (scope)

Confirmed 2026-08-27. Extends `doc/online-orders-scope.md`; nothing there is
withdrawn.

## 1. Why

Twinspark quotes prices by phone/WhatsApp before the customer ever opens
`/order` — courier included, a walk-in discount, a bulk rate. Until now the
form showed a total computed from the catalogue and gave the customer no way
to pay the amount they were actually told. Combined with the per-tyre prices
being hidden (same date), the customer had a number they could not reconcile
against the quote and no way to correct it.

## 2. What changed

The order stores **two** figures instead of one:

| Column | Meaning | Written by |
|---|---|---|
| `computed_amount` | Catalogue value of the order | `submit_online_order()`, always, server-side |
| `total_amount` | What the customer will actually pay | The quoted amount when the customer entered one, otherwise `computed_amount` |
| `amount_is_overridden` | Generated — `total_amount is distinct from computed_amount` | Postgres |

This is the shape `0034_sale_line_price_override.sql` established for Sales
(`list_price` alongside `unit_selling_price`): the deviation stays visible and
auditable rather than overwriting the reference figure.

`amount_is_overridden` is a **stored generated column**, not a flag the insert
path sets, so it cannot fall out of sync with the two amounts — same reasoning
as `stock_status` in `0001_inventory_schema.sql`.

## 3. Decisions

- **Prefilled, editable.** The field starts at the catalogue total and stays in
  step with the quantity steppers *until the customer types in it*. After that
  the typed figure stands — changing quantity afterwards must not silently
  overwrite the amount the shop quoted.
- **The quoted amount is sent only when the customer actually changed it.** An
  untouched field submits `null`, so `submit_online_order()` recomputes the
  price itself. A price that moved between page load and submit is therefore
  picked up rather than frozen, and the order is not wrongly flagged.
- **Warn, don't block.** A mismatch surfaces as a warning band in the Verify
  Payment dialog (where the screenshot is checked anyway) and a `Quoted` marker
  on the orders table row. It does not gate approval: a quoted discount is the
  normal case here, and an extra approval step would tax the common path to
  catch the rare one.
- **Revenue follows what was charged.** The Online Orders "Dispatched Amount"
  stat sums `total_amount`, so it reconciles against money received. Use
  `computed_amount` if list value is ever wanted instead.

## 4. Guarding a public write path

`/order` is the app's only anonymous write path, so a client-supplied money
figure needs bounds. Enforced in `submit_online_order()`, not in the client:

- Must be greater than zero.
- Must not exceed **3× the catalogue value** — ample room for courier charges
  or a quantity-based quote, while refusing an absurd figure.
- When the catalogue value is 0 (neither position has an active priced item)
  there is no multiple to take, so a flat **₹1,00,000** ceiling applies. This
  is deliberately *not* a floor under the 3× rule, which it would otherwise
  swallow for every realistically-sized order.

There is **no lower bound beyond "greater than zero"**, on purpose. A too-low
amount is caught by a human at Verify Payment, and a percentage floor would
block legitimate advance or part-payment arrangements the shop may want to
quote. The trade-off to be aware of: an anonymous visitor *can* submit a ₹1
order, and it is a staff member at verification — not the database — who stops
it going out.

The client-side `MAX_QUOTED_AMOUNT` in `services/online-orders/schemas.ts`
exists only to give a typo instant feedback. It is not a security boundary; a
client-side cap can always be bypassed.

## 5. Out of scope

Per-order price approval workflow, a quote record the customer's entry is
matched against, reconciliation of the entered amount against the payment
screenshot (still a human reading an image), and any change to how Dispatch
consumes stock.
