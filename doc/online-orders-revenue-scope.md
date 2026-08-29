# Online Orders — counting the money (expected behaviour)

**Status: proposed, awaiting approval. No code written yet.**

## 1. The problem

`dispatch_online_order()` deducts stock and sets the status to Dispatched. It
creates no sale, no invoice and no payment record. So the tyres leave the shelf
and the money appears nowhere except the "Dispatched Amount" line of the Online
Orders Report.

Today an online order is invisible to: Dashboard UPI Collected, Cash Collected,
Sales Amount, Profit and Invoices; and to the Sales, Collections, Revenue,
Profit and GST reports.

## 2. The governing principle

> **"Sales" always means the Sales module. Online is a third channel, shown
> alongside Sales and Service wherever money is totalled — never mixed into
> the Sales list, the Sales Report, or sales invoice numbering.**

That keeps every screen reconcilable: if the Dashboard says Sales Amount is
₹42,000, the Sales Report still adds up to ₹42,000. Online money is added as
its own figure, not folded into someone else's.

## 3. What changes, screen by screen

### 3.1 Dashboard

| Figure | Behaviour |
|---|---|
| Sales Amount | **Unchanged** — Sales module only, so it still reconciles with the Sales Report |
| Service Amount | **Unchanged** |
| **Online Orders** *(new)* | Total charged on orders **dispatched** in the range, with the order count underneath |
| Profit | **Changes** — now (Sales + Service + Online) − cost of goods for all three. Hint text becomes "sales + service + online − COGS" |
| Invoices | **Unchanged** — counts Sales-module bills only. The online count sits on the new Online card |
| Cash Collected | **Unchanged** — an online order is never cash |
| **UPI Collected** | **Changes** — includes the full amount of every order dispatched in the range. *This is the figure you reported* |
| Track Tyre Front / Back | Unchanged — stock already moves correctly |

The "vs last month" arrows use the same widened definitions, so the comparison
stays like-for-like.

### 3.2 Reports

| Report | Behaviour |
|---|---|
| **Collections** | Online amounts join the **UPI** column, dated by dispatch. Outstanding is untouched — an online order is always paid in full before it is submitted |
| **Revenue** | Gains an **Online** column beside Sales Amount and Service Amount, and is included in the trend total |
| **Profit** | Gains online revenue and online cost of goods, so shop profit is complete |
| **Sales Report** | **Unchanged** — no online rows, ever |
| **GST Report** | **Unchanged** — see §6 |
| **Online Orders Report** | Unchanged — already correct |
| Inventory / Ageing Stock | Unchanged — already correct, stock moves today |

### 3.3 Cost of goods

Every `ONLINE_ORDER_DISPATCH` stock movement already records the exact purchase
batch it drew from, so the real FIFO cost is available with no new data. It is
included wherever online revenue is now included, so revenue and cost always
move together and Profit can never be overstated.

## 4. The invoice

A **Print Invoice** button appears on a **Dispatched** order — on the Online
Orders page, nowhere else.

- Its own numbering series, separate from shop bills, so counter invoices and
  online invoices never collide or share a sequence.
- The number is assigned once, at dispatch, and never changes.
- Shows: shop details, customer name / mobile / delivery address / PIN code,
  the front and back tyre lines with quantities, the amount charged, **Paid by
  UPI**, and the dispatch date.

**One case to get right:** if the customer entered a quoted amount that differs
from the catalogue price, the tyre lines will not multiply out to the total. The
invoice shows the line prices, then the difference as an explicit adjustment
line, so the customer can see how the figure was reached rather than being
handed an invoice whose arithmetic looks wrong.

## 5. Rules and edge cases

1. **Dispatch date decides the period.** An order paid on Monday and dispatched
   on Tuesday counts on Tuesday — the same day the stock moves. Revenue and
   stock always land in the same period.
   *Known trade-off:* money that reached the UPI account on Monday shows in
   Tuesday's UPI Collected. Accepted so the books stay internally consistent.
2. **All online money is UPI.** The customer pays through the QR before
   submitting; nothing online is ever cash.
3. **Only Dispatched orders count.** Submitted, Payment Verified and Approved
   orders are money in the bank but not yet earned. Rejected orders never count.
4. **The customer-quoted amount is the amount.** If they entered their own
   figure, that is what counts as revenue — not the catalogue value. Consistent
   with the decision already made for the order form.
5. **A zero-priced position counts as zero.** If a tyre position had no price at
   submission, it contributes nothing rather than blocking anything.
6. **No double counting.** Dispatch still deducts stock exactly once, exactly as
   it does today. Nothing about stock behaviour changes.

## 6. Deliberately not doing

- **No `sales` row is created.** Online orders keep their own table, their own
  page and their own numbering. Nothing new appears in the Sales list.
- **No GST on online orders.** The order table has no GST fields and the public
  order page never asks about tax, so online orders stay out of the GST Report.
  If Twinspark must charge GST on online sales, that is a separate piece of work
  — flagged here so it is a decision rather than an oversight.
- **No customer record is created** from an online order. Online customers stay
  in the order, not in Customers & Vehicles. Say the word if the shop wants
  online buyers in the customer book.
- **No change to who can do what.** Admin and Sales Person dispatch, exactly as
  now.

## 7. Approval

Confirm §3 and §5 and I will build it, verify against a real Postgres replay as
usual, and report back.
