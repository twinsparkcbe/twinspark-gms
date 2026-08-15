# Combo Offers — Feature Plan

**Status:** Proposal, awaiting confirmation (module workflow step 1).
**Trigger:** The ₹7,499 combo poster — front + back tyres with fitting,
General Service (oil & air filter, brake pads, engine oil), water wash, foam
wash, chain clean & lubing, all for one fixed price.
**Scope:** Extends the Service Catalog and Service job entry. No change to how
stock moves, how invoices are numbered, or who can access what.

---

## 1. What Manage Service Catalog does today

Two lists, both full CRUD, both soft-deactivate (never delete):

**General Service Packages** — name, "included items" (free text, purely
descriptive), one service charge, active flag, plus linked **default inventory
items** with a quantity each.

**Specific Services** — name, optional default charge (blank means "type it per
job"), active flag, plus the same linked default items.

On a Service Job you can have 0–1 package, any number of specific services, and
any number of custom lines. Picking a catalog entry auto-fills its linked items
into Parts Used.

### How a job is priced today

```
  Service lines      package charge + each specific service charge
+ Parts Used         every part at its own selling price
+ GST                optional
− Discount           optional
= Grand Total
```

So "Standard Service" at ₹850 with 1L engine oil (₹450) and an oil filter
(₹250) linked to it bills **₹1,550**, not ₹850. Linked items always add to the
bill on top of the service charge.

---

## 2. Why the poster combo doesn't fit

Five concrete gaps, in order of how much work each represents.

### Gap 1 — Parts are always billed on top. A combo needs them included.

₹7,499 has to be the whole bill. Today there is no way to say *"this part
leaves stock but is already paid for by the package price."* Link engine oil to
a combo and its ₹450 lands on the invoice regardless.

This is the core change: each thing inside a combo needs to be marked
**Included** (comes out of stock, adds ₹0) or **Extra** (billed on top).

### Gap 2 — A package can't contain other catalog entries.

The poster combo is really *General Service + Water Wash + Foam Wash + Chain
Clean + tyres*. Today the only way to express that is retyping it into the
free-text "included items" field, which is descriptive only — reports can't read
it, and the prices aren't linked to anything. A combo should **reference** the
catalog rows that already exist, so one price change flows everywhere and the
Service Report can still say how much water-washing the shop did.

### Gap 3 — Tyres and fitting belong to Sales, not Service. ⚠

This is the decision that shapes everything else. Confirmed project rules:

- Fitting charges (₹300/wheel) apply **only** on Sales invoices.
- Labour charges apply **only** on Service invoices.
- Tyres are sold through Sales, which deducts stock and adds a fitting line.

The poster puts "front and back tyres with fitting" inside what is otherwise a
Service job. Three ways out:

| Option | How it works | Cost |
|---|---|---|
| **A. Service job absorbs it** *(recommended)* | Tyres become Parts Used on the Service job; the combo price covers the fitting, so no separate fitting line is raised at all | One invoice, one job, simple. Doesn't break the "fitting is Sales-only" rule so much as sidestep it — no fitting line is ever charged |
| B. Bill as a Sales invoice | Fits the tyre/fitting rules exactly | Sales has no concept of service packages, labour, or job cards — you'd be rebuilding half of Service inside Sales |
| C. Two invoices | Rules stay pristine | Customer gets two bills for one advertised price. Worst outcome |

**Recommendation: A.** It keeps one job, one invoice, one number for the
customer, and needs no change to the Sales module.

### Gap 4 — "Which tyre?" can't be answered when the combo is created.

₹7,499 covers "front and back tyres", but the actual tyre depends on the bike
that turns up. Two ways:

- **Placeholder slot** *(recommended)* — the combo says "2 × tyre, chosen at
  billing", optionally restricted to a category/brand and an optional price
  ceiling. The admin picks the real items when creating the job; stock deducts
  from whatever was picked.
- **Pinned items** — the combo names exact tyre products. Means one combo per
  tyre size, which becomes unmanageable fast.

### Gap 5 — No offer window, and no record of what the combo was worth.

"Combo offer" implies it runs for a period. And later you'll want to know what
the ₹7,499 covered at list price — both to tell the customer what they saved,
and for the Profit report to make sense.

---

## 3. The plan

### A. Data model — a new Combo, not an overloaded Package

Recommend **new tables** rather than extending `general_service_packages`. A
combo prices fundamentally differently (fixed total, contents included), and
folding that into packages would make every existing package's behaviour
ambiguous — "does this one bill its items or not?" — including for the jobs
already in the database.

- **`service_combos`** — name, combo price, description, active flag, optional
  valid-from / valid-to.
- **`service_combo_components`** — one row per thing in the combo:
  - what it is: an existing Package, an existing Specific Service, a specific
    Inventory Item, or a **placeholder slot**
  - quantity
  - **pricing: Included or Extra**
  - for placeholders: a label ("Front tyre"), an optional category/brand
    restriction, an optional maximum price

Existing conventions carried over unchanged: soft-deactivate never delete, name
snapshotted onto the job at insert time, prices copied not looked up live.

### B. Manage Service Catalog — a third tab

**Combo Offers**, alongside Packages and Specific Services, with the same table,
search, activate/deactivate and dialog patterns already in use.

The builder screen: name, combo price, optional offer dates, then a component
list assembled with **the same search-anything picker already built for the job
form** — type "water wash", press Enter, it's in. Each row shows quantity and an
Included / Extra toggle.

A live readout while building:

```
  List value if bought separately    ₹9,240
  Combo price                        ₹7,499
  Customer saves                     ₹1,741   (19%)
  Estimated cost of goods            ₹4,860
  Estimated margin                   ₹2,639
```

That last pair is the thing worth having — it stops a combo being priced below
cost by accident.

### C. Service job entry

- Combos appear in the **same unified picker** as everything else (a fourth
  kind), so adding one stays: type, Enter.
- Picking a combo adds **one service line at the combo price**, and fills Parts
  Used with all included items automatically, each at ₹0 and tagged
  "included in combo".
- Any placeholder slots raise a small inline prompt — "Front tyre: pick one" —
  restricted to the allowed category. Non-blocking while the job is a draft;
  required before billing, since stock can't deduct from a placeholder.
- Everything stays editable afterwards, same as every other auto-fill in this
  system.

### D. Invoice and job card

- The combo prints as **one line at ₹7,499**, with its contents listed beneath
  as an indented breakdown with no prices — so the customer sees what they got
  without the numbers contradicting the headline price.
- Optional "You saved ₹1,741" line. **Your call** — good for the customer, but
  it does publish your list-vs-offer gap in writing.

### E. Stock — no mechanism change

Included items still deduct exactly once, atomically, at completion, through
the same `adjust_stock()`. The only difference is what they contribute to the
bill (nothing). Placeholder slots must be resolved before completion.

### F. Reports

- **Service Report** gains combos as a service type — how many of each sold.
- **Profit Report** — revenue is the combo price; cost is the purchase price of
  every included item. This already works in principle because usage rows
  snapshot cost, but it needs verifying that an included-at-₹0 row still carries
  its purchase price. Otherwise every combo looks like pure profit.
- Worth adding: combo revenue vs list value, so you can see what the offers cost
  in forgone margin.

---

## 4. Rough size

| Piece | Notes |
|---|---|
| Migration — two new tables + RPCs | Follows the exact shape of `0017_service_catalog_items.sql` |
| Catalog service layer + tests | Mirrors the existing package/service CRUD |
| Combo builder UI | The biggest single piece — the price/margin readout is new |
| Picker + job entry integration | Small: the picker already handles multiple kinds |
| Invoice / job card breakdown | Small, but touches customer-facing print |
| Reports | Small, mostly verification that cost still flows |

---

## 5. Confirmed decisions

1. **Tyres + fitting inside a Service job — Option A.** Tyres become Parts Used
   on the Service job; the combo price covers the fitting, so no separate
   fitting line is ever raised. One job, one invoice, no change to Sales'
   own fitting rule (which still applies to every non-combo tyre sale).
2. **New tables**, not an extension of General Service Packages.
3. **Every combo pins exact products.** No placeholder slots — see §6.1 for
   what this costs and how it's mitigated.
4. **"You saved ₹X" prints on the customer invoice.**
5. **Offer validity dates are in scope now** — optional valid-from / valid-to
   per combo, on top of the active flag.
6. **Combos work in Sales as well as Service** — see §6.2.

## 6. Consequences of those choices

### 6.1 Pinning exact products means one combo per tyre fitment

The poster's "front and back tyres" resolves to a specific front and rear
product. Pinning means a separate combo row per fitment — a Duke 390 combo, an
Apache combo, a Pulsar combo — each otherwise identical.

Two things keep that manageable, both worth building in from the start:

- **Duplicate combo** action in the catalog list: clone an existing combo,
  change the two tyre lines and the name, save. Turns a 10-line rebuild into a
  2-field edit.
- **Combo name auto-suggests from its tyre components**, so the list stays
  readable ("₹7,499 Combo — Duke 390") without the admin inventing a
  convention.

If the count gets out of hand later, placeholder slots can be added without
disturbing anything built here — a placeholder is just a fourth component type.

### 6.2 Combos span both modules, so they aren't "service" combos

Since a combo can be sold from Sales too, the tables and service layer are
named plainly — `combos` / `combo_components`, living in `services/combos/` and
shared by both modules — rather than `service_combos`. This follows the
project's rule that shared logic gets extracted into a service both modules
call, not duplicated per module.

Behaviour differences the shared code must respect:

| | Service job | Sale |
|---|---|---|
| When stock deducts | At completion, once | Immediately, as today |
| Fitting line | Never raised — combo price absorbs it | Never raised for combo lines; unchanged for ordinary tyre sales |
| Invoice | Service invoice (`TW-J-…`) | Sales invoice, existing sequence |

The combo *definition* is identical in both; only the host module's existing
stock and invoicing rules apply around it.

## 7. Test cases

Written and confirmed — delivered in chat per the module workflow (98 cases
plus #76a, the fitting double-charge warning).

## 8. Build status — complete

### Migrations (⚠ both need applying to the live Supabase project)

- **`0021_combo_offers.sql`** — `combos` + `combo_components`, with
  `create_combo` / `update_combo` / `duplicate_combo` / `set_combo_active` as
  the only write path. Read is admin **and** sales_person; defining a combo is
  admin-only.
- **`0022_combo_lines.sql`** — `combo_id`, `combo_contents`,
  `combo_list_value` and `included_in_combo` on `service_job_lines`,
  `service_inventory_usage` and `sale_items`; a `COMBO` line type on both;
  extended `replace_service_job_lines()` and `record_sale()`.

### Shared layer — `services/combos/`

`schemas` · `types` · `availability` (IST-correct offer window) · `pricing`
(list value, savings, cost, margin) · `resolve` (module-neutral seeds) ·
`catalog` (CRUD + duplicate). 113 tests.

### UI

- **Manage Service Catalog** gains a Combo Offers section, listed first, with
  duplicate / edit / activate and an "Outside offer dates" badge for a combo
  that's switched on but out of window.
- **Combo builder dialog** — contents assembled with the same search picker as
  the job form, an Included/Extra toggle per row, and a live readout of list
  value, saving, cost of goods and margin, with a blocking warning if the
  combo sells below cost.
- **Service job entry** — combos appear in the same picker, expand to one
  priced line plus ₹0 stock rows tagged "In combo".
- **Invoice and job card** — the combo prints as one line with its contents
  listed unpriced beneath; included parts read "Included" rather than ₹0.00;
  a "You saved ₹X" line sits below the grand total.

### Asymmetry worth remembering

Service expands a combo **client-side** (a job stays editable, so the form is
the source of truth). Sales expands it **server-side** inside `record_sale()`
(a sale is one shot and never edited, so the client can't mis-state the
bundle or skip a deduction).

### Cost of goods

No snapshot column was needed. `getCostOfGoodsSold()` derives cost from
`stock_movements` joined to the FIFO purchase batch, so an item billed at ₹0
still carries its real cost — a combo can't read as pure margin (test #90).

### Not done

The Sales **form** doesn't yet offer combos in its line picker — the schema,
RPC and shared layer all support it, but the Sales UI is untouched, including
the #76a "this combo already covers fitting" warning. Reports also don't yet
break out combo revenue vs list value.
