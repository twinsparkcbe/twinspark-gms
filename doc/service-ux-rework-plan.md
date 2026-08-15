# Service Module — UX / Flow Rework Plan

**Status:** Proposal, awaiting confirmation (module workflow step 1).
**Scope:** Workflow and screen layout only. **No feature is added or removed.**
Same data model, same business rules, same statuses, same invoice and job card,
same reports, same access rules. Only the *route the admin's hands take* changes.

**Who this is for:** one Administrator, using this all day, every day, with a
customer standing in front of them.

---

## 1. What the day actually looks like today

Three things happen over and over. Here's what each costs right now.

### Flow A — A bike arrives (drop-off)

| # | Action |
|---|--------|
| 1 | Sidebar → Service |
| 2 | Click **Accept Vehicle** (page load) |
| 3 | Type mobile number (name/vehicle/model auto-fill — good) |
| 4 | Type odometer reading — **required**, so if nobody read it off the bike yet, the form is blocked |
| 5 | Tap a complaint chip (optional) |
| 6 | Click **Accept Vehicle** |
| 7 | Lands on the **job detail page** — a screen nobody asked for and nothing to do on |

≈ **4 clicks + 2 page loads**, and it ends somewhere useless.

### Flow B — Work is finished, bill it (the most-repeated flow of the day)

| # | Action |
|---|--------|
| 1 | Sidebar → Service |
| 2 | Find the job — scroll, or type in search |
| 3 | Click job number → **detail page loads** |
| 4 | Click **Edit** → **form page loads** |
| 5 | Click *Add General Service* → an empty row appears |
| 6 | Open the dropdown, scroll the catalog, pick the package |
| 7 | Click *Add Specific Service* → another empty row |
| 8 | Open dropdown, scroll, pick |
| 9 | Repeat 7–8 for each extra service |
| 10 | Click *Add Part* → empty row |
| 11 | Open the item picker, search, pick |
| 12 | Type the quantity |
| 13 | Scroll down, tick GST if needed |
| 14 | Scroll to the Payment dropdown, pick *Paid* |
| 15 | Click **Complete & Generate Invoice** |
| 16 | Invoice opens → click browser Print |

≈ **14–18 clicks and 3 page loads** for an ordinary job. Two of those page
loads (detail, then Edit) exist only to get to the screen where the actual
typing happens.

### Flow C — Customer comes to collect

| # | Action |
|---|--------|
| 1 | Service list |
| 2 | Search for the job |
| 3 | Click job number → detail page loads |
| 4 | Payment dropdown → open → pick *Paid* |
| 5 | Delivery dropdown → open → pick *Delivered* |

≈ **5–7 clicks + a page load** to record two facts that take two seconds to say.

### The underlying problems

1. **The detail page sits in the middle of every path** but is read-only —
   you always have to click through it to get anywhere useful.
2. **Adding one service takes three separate decisions**: which *type* of line
   (General / Specific / Custom), then create an empty row, then hunt through a
   plain unsearchable dropdown. The scope doc (§22) asked for a searchable,
   keyboard-first picker with common services on top — that part never got built.
3. **Two separate screens for the same job** (`Accept Vehicle` and `enter full
   details now`), with a "or…" link forcing a small decision every single time.
4. **Services and Parts are two separate tables** with two separate "Add"
   buttons, so you scroll between them and read two subtotals.
5. **Required fields at the wrong moment** — odometer is mandatory at drop-off,
   which is exactly when nobody has it.
6. **Two competing primary buttons** on the form: *Complete & Generate Invoice*
   in a card in the middle, *Save Draft* at the very bottom. You scroll to find
   the one you want.
7. **The list has no "today" view.** Every morning you re-apply the same status
   filter to see what's actually in the shop.

---

## 2. The plan

Nine changes, roughly in order of time saved.

### Change 1 — One search box replaces "pick a type → add row → open dropdown"

**The single biggest win.** In the work-entry screen, replace the three
*Add …* buttons and the empty-row-then-dropdown dance with one box:

> Type "chain" → a single list appears showing matching General Packages,
> Specific Services **and** Parts together → press Enter → the line is added
> with its price already filled in.

Type something the catalog doesn't have and press Enter → it becomes a
Custom line automatically. **The admin never picks a "line type" again** — the
system knows what it is from what was chosen.

Above the box, a row of **tap-chips for the shop's most-used services**, ranked
by how often they've actually been billed (Standard Service, Water Wash, Chain
Cleaning…). For a routine job that's *one tap per service*.

- Today: 3 services = 9 interactions. After: 3 taps.

### Change 2 — Services and Parts become one list

One continuous "What was done" list, each row tagged *Service* or *Part*, with
one running total at the bottom. Underneath, the data is stored exactly as it is
now (two separate tables) — this is purely what the eye sees. Quantity gets − / +
buttons instead of typing into a number field.

### Change 3 — Cut the detail page out of the critical path

The detail page stays exactly as it is, reachable by clicking the job number.
It just stops being a toll booth:

- An active job's row button becomes **"Bill this job"** → goes *straight* to
  the work-entry screen. Saves 2 page loads, every job.
- A completed job's row gets **Paid** and **Delivered** as one-tap chips
  **right in the list row** — no page load, no dropdown. Flow C drops from
  ~6 clicks to **2 taps**.

### Change 4 — A "Today" board as the Service home

Three tabs above the same table you already have:

- **In the shop** (Draft / In Progress / Ready) — the default landing view
- **To bill** — work done, no invoice yet
- **Awaiting payment or pickup** — billed, money or bike still outstanding
- **All jobs** — today's existing table with all its filters, untouched

Nothing is removed; the filters and search all stay. This just means the admin
stops re-applying the same filter every morning.

### Change 5 — Merge the two entry screens into one that grows

One screen instead of `Accept Vehicle` + `enter full details now`:

- Top: customer / vehicle / complaint (what intake asks today)
- Below: the work list — quiet and collapsed when there's nothing in it
- Two buttons: **Accept vehicle** (saves and returns to the board) and
  **Complete & Bill** (only lit up once there's at least one line)

Same screen at drop-off and at billing, so there's one layout to learn, and no
"which screen do I want" decision at the counter. After accepting a vehicle it
returns to the board — not to a dead-end detail page.

### Change 6 — Fewer blockers at the wrong moment

- **Odometer**: pre-fill the vehicle's last known reading for a returning bike,
  and make it *optional at drop-off* (still asked for at billing).
  Right now it hard-blocks acceptance. **⚠ This changes a validation rule —
  needs your explicit OK.**
- **Vehicle model**: already auto-fills for known bikes; stays required only for
  a genuinely new vehicle.
- **GST**: remember whatever was used last time and default to it, so the shop's
  normal habit costs zero clicks.

### Change 7 — One obvious "next step" button per job

All five statuses stay in the database and in reports — no data change. In the
UI, each job shows a single next-step button that does the obvious thing:
*Start work* → *Ready* → *Bill*.

And **"Ready for Delivery" stops looking mandatory** — the system already allows
billing directly from In Progress, so it becomes an optional marker rather than
a step the admin feels obliged to click.
**⚠ Need to know: does the shop actually use "Ready for Delivery" in practice?**
If not, it can be hidden from the main path entirely (still in the data).

### Change 8 — Pinned totals and one primary button

On the work-entry screen, the running total and the main action stay pinned to
the bottom of the screen while you scroll. One clear primary button that changes
its label with the situation (*Accept vehicle* → *Complete & Bill*), with *Save
for later* as the quiet secondary. No more scrolling to find the right button.

### Change 9 — Small everyday savings

- After billing, the invoice opens with the **print dialog already up** —
  one click saved on literally every job.
- Search box **focused automatically** when the Service page loads: land, type
  the vehicle number, hit Enter.
- **Full keyboard operation** on the work screen: Enter adds a line, arrows
  move, Esc closes. No mouse needed for a routine job.

---

## 3. Before / after

| Daily task | Today | After | Saved |
|---|---|---|---|
| Accept a bike | ~4 clicks, 2 page loads, ends on a useless page | ~2 clicks, 1 page load, ends back on the board | ~50% |
| Bill a finished job (3 services + 1 part) | 14–18 clicks, 3 page loads | 5–7 clicks, 1 page load | ~65% |
| Mark Paid + Delivered | 5–7 clicks + page load | 2 taps, no page load | ~70% |
| Find what's in the shop right now | apply filter manually each time | it's the default view | — |

Realistically that's **a few minutes saved per job** — which on a 15-job day is
most of an hour back at the counter.

---

## 4. What does NOT change

- Every feature in the confirmed scope doc stays. Nothing is dropped.
- Database tables, columns, statuses, sequences — **no schema change needed**
  for any of the above (the "most used services" ranking reads existing job
  history; no new table).
- Stock still deducts once, at completion, and never earlier.
- Job Card, Invoice, Reports, Dashboard figures, GST/discount maths, roles and
  access — all untouched.
- The full filterable job table, the timeline, mechanic notes, before/after
  images — all still there, just not in the way.

---

## 5. Confirmed decisions

1. **Odometer is optional at drop-off** (Change 6). Prefilled from the vehicle's
   last known reading for a returning bike. At billing, a missing odometer
   **warns but never blocks** — consistent with the module's rule that the only
   hard stops are "at least one line" and "enough stock".
2. **The two entry screens merge into one** (Change 5). `/service/intake` and
   `/service/new` become a single screen that grows; the "or enter full details
   now" fork disappears.
3. **"Ready for Delivery" stays, but off the main path** (Change 7). Still in the
   data and still reportable; in the UI it's a secondary marker, never the
   primary button. Billing directly from In Progress is the normal route.
4. **Build order:** Changes 1 + 3 first (biggest time saving, smallest blast
   radius), then 5 + 6, then 4, then 2 / 7 / 8 / 9.

### Required before implementation

**⚠ New migration.** `0016_service_schema.sql` declares
`odometer_reading integer not null check (odometer_reading >= 0)`, and both
`create_service_job` and `update_service_job` raise `22023` when it is null.
A new migration must drop the NOT NULL constraint and relax both RPC guards —
**and it must be applied to the live Supabase project**, not just committed.

**Refactor, no behaviour change.** Totals, the default-item merge and form
validation currently live inline in `service-job-form-client.tsx`. They move into
pure modules (`picker.ts`, `totals.ts`, `parts-merge.ts`, `board.ts`,
`next-step.ts`) so they're unit-testable in the same vitest style as the rest of
`services/`.

## 6. Test cases

Written and confirmed (delivered in chat, per the module workflow) — 92 cases
across: unified picker, most-used ranking, totals, default-item merge, board
tabs, next-step resolution, odometer validation and prefill, the merged entry
screen, inline row actions, and regression guards (stock timing, invoice
numbering, job card, purchase-price isolation, role access).

## 7. Build status

### Done — Changes 1 and 3

**New pure modules** (`services/service/`), all unit-tested:

| Module | What it owns |
|---|---|
| `picker.ts` | One search index over packages, specific services and items; ranking; resolving a pick into a line or a part; custom-line fallback |
| `frequent.ts` | Most-billed ranking from COMPLETED job history, feeding the quick-add chips |
| `usage-counts.ts` | Thin server wrapper the two entry pages call; degrades to an unranked picker if it fails |
| `totals.ts` | Running totals, extracted from the form component |
| `parts-merge.ts` | Default-item merge, extracted from the form component |
| `next-step.ts` | The single next-step action per job |

**New components:** `service-line-picker.tsx` (search box + quick-add chips +
full keyboard control), `service-row-actions.tsx` (next-step button in the list
row).

**Changed:** the job form now has one "Work Done" card — picker on top, service
lines and parts beneath it — instead of three "Add …" buttons, per-row catalog
dropdowns and two separate cards. List rows carry their own next-step button;
payment and delivery fire in place, and billing jumps straight to the entry
screen instead of stopping at the detail page.

**Tests:** 178 passing across the Service module (91 of them new).

### Fixed along the way

The existing `catalog.test.ts` and `jobs.test.ts` fixtures used placeholder ids
(`"pkg-1"`, `"job-1"`) that the zod `.uuid()` schemas reject — 15 tests were
already failing before this work. Swapped in uuid-shaped constants.

### Still to do

Changes 5 and 6 (merged entry screen, optional odometer — needs the migration),
then 4 (Today board), then 2 / 7 / 8 / 9.

### Not verified in this environment

`next build` would not complete in the sandbox (process stalls at zero CPU —
an environment limitation, not a code one). `tsc --noEmit` is clean, lint is
clean apart from one pre-existing error in `jobs.ts`, and the client-safe
modules were confirmed to emit no runtime imports, so no `server-only` code can
reach the browser bundle through them. **Run `npm run build` locally before
deploying.**
