/**
 * Sets the paper the printed bills use: A5 portrait with a 7mm margin.
 *
 * WHY THIS IS A COMPONENT AND NOT A LINE IN `app/globals.css`.
 *
 * `@page` has no selector — a rule in the global stylesheet would re-paper
 * every printable screen in the app, including the courier label sheet, which
 * packs several labels onto one page and wants nothing to do with A5. The
 * obvious way around that, a *named* page (`@page bill` + `page: bill` on the
 * bill), is what produced the blank second sheet reported on 2026-09-02:
 *
 *   Chrome starts a new page wherever the page NAME changes. The bill is
 *   nested inside the app shell, and a real page has boxes after it that were
 *   never part of the bill — Next's route announcer, the toast container.
 *   Those carry the default page name, so Chrome dutifully began a fresh page
 *   for them, at the DEFAULT size. The result was a second, A4 sheet holding
 *   nothing but the browser's own header and footer — one wasted sheet on
 *   every bill printed, which is the exact waste the A5 work set out to end.
 *
 * Rendering the rule only on the pages that want it removes the transition
 * altogether: there is one page name in the document, so nothing can force a
 * page the bill did not ask for. Verified by rendering the app shell —
 * announcer and toaster included — through headless Chromium with
 * `preferCSSPageSize`: one A5 page, where the named-page version produced two.
 *
 * Everything else about the printed bill lives in the `@media print` block in
 * `app/globals.css`; this is only the paper it is printed on.
 */
export function BillPageSize() {
  return (
    <style
      // Written as raw CSS rather than JSX text so no escaping can creep
      // between here and the rule the browser parses.
      dangerouslySetInnerHTML={{ __html: "@page { size: A5 portrait; margin: 7mm; }" }}
    />
  );
}
