# Service Jobs — editable part price (scope)

Confirmed 2026-09-02. Extends `doc/service-module-scope.md`; nothing there is
withdrawn. Migration: `supabase/migrations/0040_service_part_price_override.sql`.

## 1. Why

A Service Job already let staff edit every price on it *except one*. The
service lines (General Service, Specific Service, Custom, Combo) all carry an
editable Rate, but a part under **Parts Used** billed at
`inventory_items.selling_price` with no way to change it. So a job where the
customer was quoted ₹400 for an oil that lists at ₹450 had to be fudged —
usually by dropping a discount on the whole bill, which loses *which* part was
discounted and by how much.

Sales solved the same problem in `0034_sale_line_price_override.sql`. This is
that mechanism, applied to a job's parts.

## 2. What changed

`service_inventory_usage` stores **both halves of the price**, the shape 0034
established for `sale_items`:

| Column | Meaning |
|---|---|
| `unit_price_snapshot` | What this job actually charged per unit |
| `list_price` | What the catalogue said when the row was written (0040, nullable on older rows) |

Recording both is the only way "what did we give away on this job" stays
answerable later — the catalogue price moves on its own every time a new
purchase batch lands (0011/0012), so a charged price alone cannot be compared
to anything after the fact.

Rows written before this migration keep `list_price = null`. They are not
back-filled: nobody knows what the catalogue said on the day they were billed,
and today's price would invent discounts that never happened.

## 3. Decisions

- **Anyone who can work the job may change a part's price.** Unlike Sales,
  there is **no Administrator-only floor at the item's cost price**. Service
  work is quoted as a job, and haggling on a part inside it is the same
  conversation as haggling on the labour, which was always freely editable. A
  below-cost price shows a red warning on the row and saves.
- **The cost figure itself is never printed on this screen.** The warning says
  "Below this item's cost price" without the number: the service form is a
  Mechanic's screen too, and a service total must never expose purchase price
  (same rule `services/service/totals.ts` has carried from the start).
- **Blank means the catalogue price.** An untouched row sends no price and the
  server prices it exactly as it did before this existed. A typed price must be
  greater than zero; `0` and garbage fall back to the catalogue rather than
  billing nothing.
- **This job only.** `inventory_items.selling_price` is untouched and still
  comes from the newest purchase batch.
- **Combo parts are not editable.** A part carried in by a Combo Offer still
  bills at ₹0 — the combo price already covers it (0022) — and the server
  forces that regardless of what is sent for the row.
- **Reopening a job shows the bill as it stands.** The form seeds each row with
  what the job charged, not today's catalogue price, so a negotiated part
  cannot silently revert to list on the next save. Same rule as the Sales edit
  route.
- **The printed invoice shows only what was charged.** The list price stays
  inside the app, on the row being edited, struck through with the difference
  beside it.

## 4. Where it lives

| Layer | File |
|---|---|
| Column + `replace_service_job_lines()` | `supabase/migrations/0040_service_part_price_override.sql` |
| Effective price / discount arithmetic | `services/service/totals.ts` (`effectivePartUnitPrice`, `partDiscount`) |
| Payload validation | `services/service/schemas.ts` (`serviceInventoryUsageInputSchema.unitPrice`) |
| RPC mapping | `services/service/jobs.ts` (`toRpcUsage`, `ServiceInventoryUsageRow.listPrice`) |
| The row UI | `components/service/service-parts-used.tsx` |
| Seeding + submission | `components/service/service-job-form-client.tsx` |

`replace_service_job_lines()` is the single place every line and usage row is
written — `create_service_job()`, `update_service_job()` and
`edit_completed_service_job()` all delegate to it — so creating, editing and
correcting a completed job all pick this up from one function.
