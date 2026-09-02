# Printed bills on A5 (scope)

Confirmed 2026-09-02. Affects the four printed documents only — no data, no
totals, no wording changes. All of it lives in one `@media print` block at the
bottom of `app/globals.css`, plus a handful of class hooks in the templates.

## 1. Why

The shop prints on A5 paper. The four bill views were laid out at screen
sizes — 14px body text, 36px headings, 8px table padding, pixel column widths
sized for a 768px screen — which is comfortable on A4 and spills onto a
second A5 sheet after a handful of line items. A second sheet for two extra
rows is wasted paper on every bill.

Three things were doing the damage, and only one of them was the type size:

1. **Type and spacing built for a screen.** 14px body on 134mm of paper.
2. **Pixel column widths.** `w-32` / `w-20` on the number columns left the
   description under 170px on A5, so *every* item name wrapped onto a second
   line and each row cost double.
3. **A5 is narrower than Tailwind's `sm` breakpoint.** A5 is ~559 CSS px
   wide, `sm` starts at 640px — so the Bill-To/Vehicle pair, side-by-side on
   screen and on A4, silently stacked on paper and ate four more lines.
4. **The header row wrapped.** Same cause, different symptom: the identity
   block and the INVOICE title no longer fit side by side, so the title and
   the phone numbers dropped underneath the logo and — being a shrink-to-fit
   block on a fresh line — sat against the LEFT edge, their `text-right`
   aligning nothing but themselves. On paper the width is fixed and known, so
   the row is told not to wrap: the left column may shrink (a long address
   wraps inside its own column), the right column keeps its width and stays
   pinned to the right edge.

## 2. What it does now

| | Before | After |
|---|---|---|
| Paper | whatever the dialog had | `@page { size: A5 portrait; margin: 7mm }`, set by `<BillPageSize/>` on the bills only |
| Sales bill on one sheet | ~4 items | **11 items** |
| Service bill on one sheet | ~3 items | **10 service lines + 3 parts** |

Past that the bill flows onto a second sheet deliberately, rather than
shrinking type further — a bill the customer cannot read is worse than a
second sheet. The table header repeats on sheet two, a row never splits
across the break, and the totals panel is never cut in half.

## 3. Decisions

- **The paper size is rendered by the page, not declared globally.** `@page`
  has no selector, so a rule in `globals.css` would re-paper every printable
  screen, courier labels included. `components/shared/bill-page-size.tsx`
  emits it, and only the four bills render it.
- **A named page (`@page bill` + `page: bill`) was tried first and reverted.**
  It scoped the paper correctly but added a blank second sheet to every bill:
  Chrome starts a new page wherever the page NAME changes, and a real page has
  boxes after the bill that were never part of it — Next's route announcer and
  the toast container. Those carry the default page name, so Chrome began a
  fresh page for them at the DEFAULT size. That is what the reported "second
  page with only the URL and date on it" was: an A4 sheet holding nothing but
  the browser's own header and footer. One page name in the document means
  nothing can force a page the bill did not ask for.
- **The browser's own header/footer is a print-dialog setting**, not
  something CSS can remove. Untick "Headers and footers" in Chrome's print
  dialog to keep the URL and timestamp off the bill.
- **Print styles live outside Tailwind's cascade layers.** Unlayered CSS beats
  layered utilities regardless of specificity, so a `text-sm` or `p-8` in the
  markup cannot quietly win back its screen size.
- **The type scale is mapped once** (`text-lg` → 10pt, `text-sm` → 7.2pt, and
  so on) rather than a print size written beside every text class in four
  templates.
- **A few Tailwind utilities are overridden by name inside `.bill-sheet`**
  (`mt-4`, `gap-8`, `sm:grid-cols-2`, …). Deliberate: these are the only
  spacers the four bills use between blocks, and the alternative is a dozen
  extra class names in the markup whose only purpose is to be shrunk here.
  Scoped to `.bill-sheet`, so nothing else in the app is touched.
- **Screen rendering is unchanged.** Everything is inside `@media print`.

## 4. Where it lives

| Layer | File |
|---|---|
| All print sizing | `app/globals.css` (the `@media print` block at the end) |
| Paper size | `components/shared/bill-page-size.tsx` |
| Class hooks | `components/sales/sales-invoice-view.tsx`, `components/service/service-invoice-view.tsx`, `components/online-orders/online-order-invoice-view.tsx`, `components/service/job-card-view.tsx` |

The hooks are the same seven names on all four documents — `bill-page`,
`bill-sheet`, `bill-accent`, `bill-logo`, `bill-business-name`, `bill-title`,
`bill-header`, `bill-contacts`, `bill-section-label`, `bill-totals`, `bill-grand-total`,
`bill-footer` — so a fifth printed document needs no new CSS, only the same
class names.

## 5. How the fit was verified

Each bill is rendered through headless Chromium with `preferCSSPageSize`, so
the page size comes from the CSS exactly as it would in a real print, and the
resulting PDF's page count and paper size are asserted rather than eyeballed
in a preview. The replica includes the app shell, Next's route announcer and
the toast container, because those are what produced the phantom second sheet.

Current capacity: 11 items on a Sales bill (12 → two sheets); a Service bill
holds 9 service lines with 3 parts, or 1 service line with 13 parts. Re-run that check after
changing anything in the block.
