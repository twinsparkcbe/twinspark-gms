# Online Orders — Feature & Use-Case List

**Status:** Draft — module workflow step 1, awaiting confirmation before test
cases / implementation.
**Relationship to source docs:** Implements spec §3.16 (Online Track Tyre
Order), §3.17 (Courier Label Export), §4.11 (Online Track Tyre Orders), and
the relevant rows of the §6 permission matrix.
**Standards carried over from Inventory/Purchases/Sales/Service:** shared
`adjust_stock()` as the only stock-mutating path, existing `customers` table
and its "one row per mobile number" lookup-or-create pattern (`0013_sales_
schema.sql`), same filter/table/pagination/stats-card UI conventions, same
Server Action + service-layer + Zod validation layering, storage-bucket
pattern from `0002_inventory_images.sql`/`0016_service_schema.sql` for the
payment screenshot upload, and the browser-print approach already shipped
for Sales/Service invoices (no PDF library) for the courier label export.

**Why this module matters (owner's view):** track tyre customers increasingly
order online and pay by UPI/bank transfer before I ever see them — I need one
place to see who's paid, who's waiting, and who's ready to ship, so nothing
gets missed and nobody gets a tyre before their payment actually clears.

---

## 0. What's new since the spec was written — Track Tyre Front/Back

The spec (§3.16) predates the Track Tyre Front/Back split we just shipped in
Purchases/Inventory. At the time it was written, "Track Tyre" was a single
item with one stock count, so the order form only asked for a *quantity*.
Now that Front and Back are separate inventory rows with independent stock,
an online order for "2 track tyres" is ambiguous — which position, and how
many of each?

**Proposed handling:** the public order form asks for quantity of **Front**
and quantity of **Back** separately (either can be zero, but not both), same
as picking two line items rather than one. Internally this becomes two order
lines against the two Track Tyre inventory rows, so Dispatch decrements each
independently via the existing `adjust_stock()` — no new stock mechanism,
just two calls instead of one.

**Flagging this as a decision point** — alternative is a single quantity
field with a note field for the customer to specify position in free text,
which is simpler to build but pushes ambiguity onto manual reading of notes
before dispatch (more room for a mis-shipped pair). Recommend the two-field
approach above; say so if you'd rather keep it simple with free text.

## 1. Public order submission (customer-facing, no login)

- New public route (e.g. `/order`), added to `PUBLIC_PATHS` in
  `lib/supabase/middleware.ts` alongside `/login` and `/auth/callback` — this
  is the first genuinely public (unauthenticated) page in the app, so it
  needs its own review pass, not just a route added to the list.
- Fields: Customer Name, Mobile Number, Address, PIN Code, Quantity – Front,
  Quantity – Back (§0 above), Payment Screenshot (image upload, required).
- Validation: name/mobile/address/PIN required; PIN Code numeric, fixed
  length (6 digits, India); at least one of Front/Back quantity > 0; each
  quantity a positive integer; screenshot required, image only, size-capped
  (mirrors the 5 MB / png-jpeg-webp limits already used for inventory/service
  photos).
- On submit: inserts an `online_orders` row with `status = SUBMITTED`,
  uploads the screenshot to a new public-write, admin-read storage bucket
  (see §4), shows a simple confirmation screen with a reference number —
  no account, no login, nothing else for the customer to do.
- **No CAPTCHA/rate-limiting in this pass** — flagging as a real risk since
  this is an anonymous, unauthenticated write endpoint (anyone can submit
  garbage rows or spam uploads), but bot protection isn't in the spec and
  adds a third-party dependency (e.g. hCaptcha) that's arguably out of scope
  unless you want it. Say so if you want a v1 mitigation (e.g. a honeypot
  field, or a basic submit-rate check by mobile number) — cheap to add now,
  awkward to retrofit later.

## 2. Admin/Sales Person workflow (queue + actions)

- Orders list/queue at `/online-orders`, filterable by status (defaults to
  showing everything not yet Dispatched/Rejected first — the actionable
  ones), searchable by customer name/mobile, sortable by submitted date.
- Each row: customer name, mobile, PIN code, Front/Back quantities, status
  badge, submitted date, thumbnail/link to payment screenshot.
- **Status flow** (matches spec exactly, one-directional, no skipping
  steps): `SUBMITTED → PAYMENT_VERIFIED → APPROVED → DISPATCHED`, with a
  parallel `REJECTED` reachable from `SUBMITTED` or `PAYMENT_VERIFIED` (e.g.
  payment screenshot is fake/unreadable, or customer cancels) — rejection is
  terminal, no stock impact since it was never decremented.
- **Verify Payment** action: opens/enlarges the screenshot, marks
  `PAYMENT_VERIFIED`, records `verified_by` + timestamp. Purely a human
  judgment call — no automated payment matching (spec §8 confirms payment
  gateway integration is out of scope; this stays manual screenshot review).
- **Approve** action: marks `APPROVED`, records `approved_by` + timestamp.
  No stock effect yet.
- **Dispatch** action: marks `DISPATCHED`, records `dispatched_by` +
  `dispatched_at`, and this is the **only** point stock moves — calls
  `adjust_stock()` once per non-zero Front/Back line against the matching
  Track Tyre item, reason `ONLINE_ORDER_DISPATCH`, note referencing the
  order. If either Track Tyre item has insufficient stock at dispatch time,
  block dispatch with a clear error rather than letting stock go negative
  (matches how Sales/Purchase already guard against negative stock).
- Every status transition is logged with who/when (matches the audit-trail
  standard already used for stock movements, purchase entries, service jobs)
  — this answers "who approved this" and "who verified this payment" months
  later, not just "what's the status now."

## 3. Courier Label Export

- Select one or more orders from the queue (checkboxes) → "Export Labels"
  → dedicated print-optimized page (same pattern as the Sales/Service
  invoice pages: real route, not a modal, `@media print` stylesheet,
  browser print dialog for PDF/paper) → one label per selected order:
  Customer Name, Mobile Number, Address, PIN Code, Quantity (Front/Back
  broken out or combined — matches spec's flat "Quantity" field, shown as
  e.g. "2 Front, 1 Back").
- Available for orders in any status per spec ("typically" approved/
  dispatched, not restricted) — the export is just a formatting convenience,
  not a workflow gate.

## 4. Data model

- **New table `online_orders`**: id, customer_name, mobile_number, address,
  pin_code, quantity_front, quantity_back (replacing the spec's single
  `quantity` per §0), payment_screenshot_url, status enum (`SUBMITTED`,
  `PAYMENT_VERIFIED`, `APPROVED`, `DISPATCHED`, `REJECTED`), submitted_at,
  verified_by/approved_by/dispatched_by/rejected_by (FK → auth.users,
  nullable until that step happens), verified_at/approved_at/dispatched_at/
  rejected_at, rejection_reason (text, nullable — only set when rejected).
- **Decision point: does this link to the existing `customers` table, or
  stay a standalone snapshot?** Recommend **standalone** (no `customer_id`
  FK) — an online order is an unauthenticated, unverified claim about who
  someone is; the spec treats it as its own record with its own fields, and
  Customer & Vehicle Management (not yet built) will define what a "real"
  customer record looks like. Auto-creating/matching `customers` rows from
  anonymous input risks polluting that table with unverified data before
  that module's own rules exist. Once dispatched, staff can manually link/
  create the customer from Customer Management if desired — not automatic.
  Flagging this since it's the one real schema decision; say so if you'd
  rather auto-link by mobile number the way Sales does.
- **New storage bucket** `online-order-screenshots`: public **write** via an
  `anon`-role insert policy (first anonymous-write bucket in the app — every
  existing bucket requires an authenticated admin), **not** public read —
  screenshots should only be viewable by logged-in Admin/Sales Person, not
  guessable/public URLs, since they may contain UPI transaction details.
  This is a meaningfully different RLS shape than the existing image
  buckets and needs its own care in implementation/test cases.
- No changes to `inventory_items`, `sales`, or `service_jobs` — dispatch
  reuses `adjust_stock()` exactly as Purchases/Sales/Service already do.

## 5. Access & permissions

- Per spec §6 and project instructions (Sales Person restricted from
  Inventory/Purchases/Reports/Dashboard/Settings only — Online Orders isn't
  in that list): **Administrator** gets the full workflow; **Sales Person**
  gets View, Verify Payment, Dispatch, and Courier Label Export.
- **Open question carried over from the spec, needs your call, not mine:**
  spec §9 Q6 flags that the PRD text is ambiguous on whether Sales Person can
  **Approve** orders (the permission matrix marks it ✅ with a caveat; the
  narrative text only explicitly says "verify" and "dispatch"). Recommend
  giving Sales Person Approve too — Verify and Approve are usually the same
  person doing both in one sitting at a small shop, and gating Approve to
  Admin-only just means orders sit waiting for you specifically to log in,
  which slows down dispatch for no real fraud-prevention benefit (Dispatch
  already requires stock to exist, and every step is logged with who did
  it). Say so if you'd rather keep Approve Admin-only as an extra check.
- The public submission page (§1) has no auth at all by design — it's
  outside the Administrator/Sales Person permission model entirely.

## 6. Non-goals for this pass

- No payment gateway integration — stays manual screenshot verification
  (spec §8, project instructions: out of scope unless explicitly asked).
- No SMS/WhatsApp notifications to the customer at any status change (spec
  §8, project instructions: out of scope).
- No CAPTCHA/bot-protection service by default (§1) — flagged as a decision
  point above, not silently skipped.
- No automated matching/linking to the `customers` table (§4) — manual,
  post-dispatch, via Customer Management once that module exists.

## 7. Edge cases

- Both Front and Back quantity zero on submission → blocked client- and
  server-side (must order at least one tyre).
- Screenshot upload fails/times out → submission blocked with a retry
  prompt, not silently accepted without proof of payment.
- Order approved but stock runs out (e.g. someone else's purchase/sale
  consumed it) before Dispatch → Dispatch blocked with a clear "insufficient
  stock" error, order stays at `APPROVED` until restocked or rejected.
- Rejecting an order after `PAYMENT_VERIFIED` (payment looked valid but,
  say, the customer's address turned out to be undeliverable) → still
  allowed, no stock to roll back since Dispatch never ran.
- Duplicate submissions from the same mobile number in quick succession →
  allowed as separate orders (no dedupe) — a real customer might legitimately
  place two orders; flag as low priority unless you've seen this cause
  confusion in practice.

---

Confirm this list — especially the three flagged decision points (Front/Back
as two quantity fields, standalone vs. linked customer record, and Sales
Person's Approve permission) — and I'll move to test cases next, in chat,
per the module workflow.
