import { describe, expect, it } from "vitest";

import { NAV_ITEMS, resolveActiveHref } from "./nav-items";

describe("resolveActiveHref", () => {
  it("highlights the item whose href matches the path exactly", () => {
    expect(resolveActiveHref("/service", NAV_ITEMS)).toBe("/service");
  });

  it("highlights the parent for a child route that has no nav entry of its own", () => {
    expect(resolveActiveHref("/service/new", NAV_ITEMS)).toBe("/service");
    expect(resolveActiveHref("/service/abc-123/invoice", NAV_ITEMS)).toBe("/service");
  });

  /**
   * The reason this function exists. "/service/catalog" prefix-matches both
   * "Service" and "Service Catalog"; the old per-item check lit up both, which
   * put two nodes on the same framer-motion layoutId and broke the sliding
   * pill — not just the highlight.
   */
  it("picks the more specific nav item when two hrefs both match", () => {
    expect(resolveActiveHref("/service/catalog", NAV_ITEMS)).toBe("/service/catalog");
  });

  it("never returns more than one match for any nav item's own href", () => {
    for (const item of NAV_ITEMS) {
      const active = resolveActiveHref(item.href, NAV_ITEMS);
      expect(active).toBe(item.href);
    }
  });

  it("returns null for a route with no nav entry, rather than guessing one", () => {
    expect(resolveActiveHref("/login", NAV_ITEMS)).toBeNull();
  });

  it("does not treat a sibling with a shared prefix as a child route", () => {
    // "/settings/users" must not light up for "/settings/users-archive".
    const items = [
      { label: "Users", href: "/settings/users", icon: NAV_ITEMS[0].icon, moduleKey: "settings" as const },
    ];
    expect(resolveActiveHref("/settings/users-archive", items)).toBeNull();
  });
});
