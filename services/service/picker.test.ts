import { describe, expect, it } from "vitest";

import type { InventoryItemRow } from "@/services/inventory";

import type { GeneralServicePackageRow, SpecificServiceRow } from "./catalog";
import {
  buildPickerIndex,
  isOutOfStock,
  pickerKey,
  quickPickEntries,
  resolveSelection,
  resolveTypedTerm,
  searchCatalog,
  toCustomLine,
  type PickerEntry,
} from "./picker";

function pkg(overrides: Partial<GeneralServicePackageRow> = {}): GeneralServicePackageRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Standard Service",
    includedItems: ["Oil Change"],
    serviceCharge: 850,
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    defaultItems: [],
    ...overrides,
  };
}

function specific(overrides: Partial<SpecificServiceRow> = {}): SpecificServiceRow {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Chain Cleaning",
    defaultCharge: 200,
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    defaultItems: [],
    ...overrides,
  };
}

function item(overrides: Partial<InventoryItemRow> = {}): InventoryItemRow {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    itemType: "OTHER_SPARE_PART",
    productName: "Engine Oil 1L",
    skuCode: "ENG-OIL-1L",
    brandId: null,
    brandName: null,
    purchasePrice: 300,
    sellingPrice: 450,
    availableQuantity: 12,
    lowStockThreshold: 2,
    stockStatus: "in_stock",
    isActive: true,
    updatedAt: "2026-01-01T00:00:00.000Z",
    imageUrl: null,
    customTypeLabel: null,
    ...overrides,
  };
}

function index(overrides: {
  packages?: GeneralServicePackageRow[];
  specificServices?: SpecificServiceRow[];
  items?: InventoryItemRow[];
  usageCounts?: Record<string, number>;
}) {
  return buildPickerIndex({
    packages: overrides.packages ?? [],
    specificServices: overrides.specificServices ?? [],
    items: overrides.items ?? [],
    usageCounts: overrides.usageCounts,
  });
}

describe("buildPickerIndex", () => {
  it("returns packages, specific services and items as one flat list, each tagged with its kind", () => {
    const entries = index({ packages: [pkg()], specificServices: [specific()], items: [item()] });

    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.kind)).toEqual(["PACKAGE", "SPECIFIC", "ITEM"]);
  });

  it("excludes deactivated catalog entries (doc §16 — kept in history, never sellable again)", () => {
    const entries = index({
      packages: [pkg({ isActive: false })],
      specificServices: [specific({ isActive: false })],
      items: [item({ isActive: false })],
    });

    expect(entries).toEqual([]);
  });

  it("includes an out-of-stock item, carrying its quantity so the UI can flag it (advisory, doc §6)", () => {
    const entries = index({ items: [item({ availableQuantity: 0, stockStatus: "out_of_stock" })] });

    expect(entries).toHaveLength(1);
    expect(entries[0].availableQuantity).toBe(0);
  });

  it("carries a catalog entry's default items through, so picking still auto-fills Parts Used", () => {
    const defaultItems = [{ inventoryItemId: item().id, itemName: "Engine Oil 1L", defaultQuantity: 1 }];
    const entries = index({ packages: [pkg({ defaultItems })] });

    expect(entries[0].defaultItems).toEqual(defaultItems);
  });

  it("uses service charge as the package rate and selling price as the item rate", () => {
    const entries = index({ packages: [pkg({ serviceCharge: 850 })], items: [item({ sellingPrice: 450, purchasePrice: 300 })] });

    expect(entries[0].rate).toBe(850);
    expect(entries[1].rate).toBe(450);
  });

  it("leaves the rate null for a specific service with no default charge — blank, not zero", () => {
    const entries = index({ specificServices: [specific({ defaultCharge: null })] });

    expect(entries[0].rate).toBeNull();
  });

  it("attaches usage counts by picker key, defaulting to zero", () => {
    const entries = index({
      packages: [pkg()],
      specificServices: [specific()],
      usageCounts: { [pickerKey("PACKAGE", pkg().id)]: 14 },
    });

    expect(entries[0].usageCount).toBe(14);
    expect(entries[1].usageCount).toBe(0);
  });
});

describe("searchCatalog", () => {
  const entries = index({
    packages: [pkg({ name: "Standard Service" })],
    specificServices: [
      specific({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", name: "Chain Cleaning" }),
      specific({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", name: "Brake Bleeding" }),
    ],
    items: [item({ productName: "Rear Chain Kit", skuCode: "CHN-KIT-01" })],
  });

  it("matches case-insensitively on name", () => {
    expect(searchCatalog(entries, "CHAIN").map((e) => e.name)).toContain("Chain Cleaning");
  });

  it("returns matches across all three kinds in one result set", () => {
    const kinds = searchCatalog(index({ packages: [pkg({ name: "Chain Service" })], specificServices: [specific({ name: "Chain Cleaning" })], items: [item({ productName: "Chain Lube" })] }), "chain").map(
      (e) => e.kind
    );

    expect(new Set(kinds)).toEqual(new Set(["PACKAGE", "SPECIFIC", "ITEM"]));
  });

  it("ranks a name that starts with the term above one that merely contains it", () => {
    const names = searchCatalog(entries, "chain").map((e) => e.name);

    expect(names.indexOf("Chain Cleaning")).toBeLessThan(names.indexOf("Rear Chain Kit"));
  });

  it("ranks by usage count when match quality is equal", () => {
    const busy = index({
      specificServices: [
        specific({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", name: "Brake Bleeding" }),
        specific({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2", name: "Brake Adjustment" }),
      ],
      usageCounts: { [pickerKey("SPECIFIC", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1")]: 30 },
    });

    expect(searchCatalog(busy, "brake").map((e) => e.name)).toEqual(["Brake Bleeding", "Brake Adjustment"]);
  });

  it("falls back to alphabetical order so identical searches never reshuffle", () => {
    const tied = index({
      specificServices: [
        specific({ id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1", name: "Brake Bleeding" }),
        specific({ id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2", name: "Brake Adjustment" }),
      ],
    });

    expect(searchCatalog(tied, "brake").map((e) => e.name)).toEqual(["Brake Adjustment", "Brake Bleeding"]);
  });

  it("returns nothing for a blank or single-character term rather than dumping the catalog", () => {
    expect(searchCatalog(entries, "")).toEqual([]);
    expect(searchCatalog(entries, "c")).toEqual([]);
  });

  it("respects the result limit", () => {
    expect(searchCatalog(entries, "a", { limit: 1 }).length).toBeLessThanOrEqual(1);
    expect(searchCatalog(entries, "e", { limit: 2 }).length).toBeLessThanOrEqual(2);
  });

  it("trims surrounding whitespace before matching", () => {
    expect(searchCatalog(entries, "  chain  ").length).toBeGreaterThan(0);
  });

  it("matches an item by SKU, so a code can be typed or scanned", () => {
    expect(searchCatalog(entries, "chn-kit").map((e) => e.name)).toEqual(["Rear Chain Kit"]);
  });

  it("keeps a package and a specific service with the same name as two separate entries", () => {
    const sameName = index({ packages: [pkg({ name: "Water Wash" })], specificServices: [specific({ name: "Water Wash" })] });

    const results = searchCatalog(sameName, "water wash");
    expect(results).toHaveLength(2);
    expect(new Set(results.map((r) => r.kind))).toEqual(new Set(["PACKAGE", "SPECIFIC"]));
  });

  it("treats regex characters in the term as literal text", () => {
    expect(() => searchCatalog(entries, "brake (")).not.toThrow();
    expect(searchCatalog(entries, "brake (")).toEqual([]);
  });
});

describe("quickPickEntries", () => {
  it("ranks the most-billed services first", () => {
    const entries = index({
      packages: [pkg({ name: "Standard Service" })],
      specificServices: [specific({ name: "Chain Cleaning" })],
      usageCounts: { [pickerKey("SPECIFIC", specific().id)]: 40, [pickerKey("PACKAGE", pkg().id)]: 12 },
    });

    expect(quickPickEntries(entries).map((e) => e.name)).toEqual(["Chain Cleaning", "Standard Service"]);
  });

  it("always pins a combo, even one that has never been billed", () => {
    // The regression this guards: a brand-new combo has usageCount 0, and
    // usage-ranking alone hid it behind services that did have history — so
    // it could never be sold, so it could never earn history.
    const entries = index({
      specificServices: [specific({ name: "Water Wash" })],
      usageCounts: { [pickerKey("SPECIFIC", specific().id)]: 40 },
    });
    const withCombo: PickerEntry[] = [
      { key: "COMBO:c1", kind: "COMBO", id: "c1", name: "Weekend Combo", rate: 5999, defaultItems: [], availableQuantity: null, skuCode: null, usageCount: 0 },
      ...entries,
    ];

    expect(quickPickEntries(withCombo).map((e) => e.name)).toEqual(["Weekend Combo", "Water Wash"]);
  });

  it("orders combos before services regardless of how often the services are billed", () => {
    const busyService = index({
      specificServices: [specific({ name: "Water Wash" })],
      usageCounts: { [pickerKey("SPECIFIC", specific().id)]: 500 },
    });
    const withCombo: PickerEntry[] = [
      ...busyService,
      { key: "COMBO:c1", kind: "COMBO", id: "c1", name: "Weekend Combo", rate: 5999, defaultItems: [], availableQuantity: null, skuCode: null, usageCount: 1 },
    ];

    expect(quickPickEntries(withCombo)[0].kind).toBe("COMBO");
  });

  it("never offers a part as a chip — parts are picked per bike, not by habit", () => {
    const entries = index({ specificServices: [specific()], items: [item({ productName: "Engine Oil 1L" })] });

    expect(quickPickEntries(entries).map((e) => e.kind)).toEqual(["SPECIFIC"]);
  });

  it("falls back to alphabetical order before any history exists, so day one isn't empty", () => {
    const entries = index({
      specificServices: [
        specific({ id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1", name: "Water Wash" }),
        specific({ id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd2", name: "Brake Bleeding" }),
      ],
    });

    expect(quickPickEntries(entries).map((e) => e.name)).toEqual(["Brake Bleeding", "Water Wash"]);
  });

  it("drops never-used services once some history exists", () => {
    const entries = index({
      specificServices: [
        specific({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1", name: "Water Wash" }),
        specific({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2", name: "Rare Service" }),
      ],
      usageCounts: { [pickerKey("SPECIFIC", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1")]: 5 },
    });

    expect(quickPickEntries(entries).map((e) => e.name)).toEqual(["Water Wash"]);
  });

  it("respects the chip limit", () => {
    const entries = index({
      specificServices: [
        specific({ id: "ffffffff-ffff-4fff-8fff-fffffffffff1", name: "A Service" }),
        specific({ id: "ffffffff-ffff-4fff-8fff-fffffffffff2", name: "B Service" }),
        specific({ id: "ffffffff-ffff-4fff-8fff-fffffffffff3", name: "C Service" }),
      ],
    });

    expect(quickPickEntries(entries, { limit: 2 })).toHaveLength(2);
  });

  it("returns nothing when the catalog is empty", () => {
    expect(quickPickEntries([])).toEqual([]);
  });
});

describe("resolveSelection", () => {
  const packageEntry = index({ packages: [pkg()] })[0];
  const specificEntry = index({ specificServices: [specific()] })[0];
  const itemEntry = index({ items: [item()] })[0];

  it("turns a package into a PACKAGE line with its id, name and rate pre-filled", () => {
    const result = resolveSelection(packageEntry, { hasPackageLine: false });

    expect(result).toEqual({
      ok: true,
      target: "LINE",
      line: {
        lineType: "PACKAGE",
        generalServicePackageId: pkg().id,
        specificServiceId: null,
        comboId: null,
        comboContents: [],
        description: "Standard Service",
        quantity: "1",
        rate: "850",
      },
      defaultItems: [],
    });
  });

  it("turns a specific service into a SPECIFIC line", () => {
    const result = resolveSelection(specificEntry, { hasPackageLine: false });

    expect(result).toMatchObject({ ok: true, target: "LINE", line: { lineType: "SPECIFIC", specificServiceId: specific().id, rate: "200" } });
  });

  it("leaves the rate blank — not '0' — when the catalog has no suggested price", () => {
    const entry: PickerEntry = { ...specificEntry, rate: null };
    const result = resolveSelection(entry, { hasPackageLine: false });

    expect(result).toMatchObject({ ok: true, line: { rate: "" } });
  });

  it("turns an inventory item into a part row, not a service line", () => {
    const result = resolveSelection(itemEntry, { hasPackageLine: false });

    expect(result).toEqual({ ok: true, target: "PART", part: { inventoryItemId: item().id, quantityUsed: "1" } });
  });

  it("rejects a second General Service Package (doc §4 — 0 or 1 per job)", () => {
    const result = resolveSelection(packageEntry, { hasPackageLine: true });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringContaining("Only one General Service Package") });
  });

  it("still allows specific services and parts when a package is already on the job", () => {
    expect(resolveSelection(specificEntry, { hasPackageLine: true }).ok).toBe(true);
    expect(resolveSelection(itemEntry, { hasPackageLine: true }).ok).toBe(true);
  });

  it("passes the entry's default items through for the Parts Used merge", () => {
    const defaultItems = [{ inventoryItemId: item().id, itemName: "Engine Oil 1L", defaultQuantity: 2 }];
    const entry = index({ packages: [pkg({ defaultItems })] })[0];

    expect(resolveSelection(entry, { hasPackageLine: false })).toMatchObject({ defaultItems });
  });
});

describe("toCustomLine", () => {
  it("creates a CUSTOM line from free text, with no catalog ids and a blank rate", () => {
    expect(toCustomLine("Fork Seal Replacement")).toEqual({
      ok: true,
      target: "LINE",
      line: {
        lineType: "CUSTOM",
        generalServicePackageId: null,
        specificServiceId: null,
        comboId: null,
        comboContents: [],
        description: "Fork Seal Replacement",
        quantity: "1",
        rate: "",
      },
      defaultItems: [],
    });
  });

  it("trims the typed description", () => {
    expect(toCustomLine("  Fork Seal  ")).toMatchObject({ line: { description: "Fork Seal" } });
  });

  it("creates nothing from empty or whitespace-only text", () => {
    expect(toCustomLine("").ok).toBe(false);
    expect(toCustomLine("   ").ok).toBe(false);
  });
});

describe("resolveTypedTerm (what pressing Enter does)", () => {
  const entries = index({ packages: [pkg({ name: "Standard Service" })], specificServices: [specific({ name: "Water Wash", defaultCharge: 150 })] });

  it("resolves an exact catalog name to that catalog entry, never to a custom line", () => {
    const result = resolveTypedTerm(entries, "Water Wash", { hasPackageLine: false });

    expect(result).toMatchObject({ ok: true, line: { lineType: "SPECIFIC", specificServiceId: specific().id, rate: "150" } });
  });

  it("matches an exact catalog name regardless of case", () => {
    expect(resolveTypedTerm(entries, "water wash", { hasPackageLine: false })).toMatchObject({ line: { lineType: "SPECIFIC" } });
  });

  it("falls back to a custom line when nothing in the catalog matches", () => {
    expect(resolveTypedTerm(entries, "Fork Seal Replacement", { hasPackageLine: false })).toMatchObject({
      line: { lineType: "CUSTOM", description: "Fork Seal Replacement" },
    });
  });

  it("still enforces the single-package rule when the typed name is a package", () => {
    expect(resolveTypedTerm(entries, "Standard Service", { hasPackageLine: true }).ok).toBe(false);
  });

  it("creates nothing from an empty term", () => {
    expect(resolveTypedTerm(entries, "   ", { hasPackageLine: false }).ok).toBe(false);
  });
});

describe("out-of-stock parts cannot be added", () => {
  const outOfStockItem: PickerEntry = {
    key: "ITEM:i1",
    kind: "ITEM",
    id: "i1",
    name: "Milaze tyre",
    rate: 3100,
    defaultItems: [],
    availableQuantity: 0,
    skuCode: "TY-001",
    usageCount: 4,
  };
  const inStockItem: PickerEntry = { ...outOfStockItem, key: "ITEM:i2", id: "i2", name: "Track Tyre - Back", availableQuantity: 143 };

  it("flags a zero-stock item", () => {
    expect(isOutOfStock(outOfStockItem)).toBe(true);
  });

  it("does not flag an item with stock", () => {
    expect(isOutOfStock(inStockItem)).toBe(false);
  });

  // Negative stock shouldn't ever happen, but it must not read as sellable.
  it("flags negative stock too", () => {
    expect(isOutOfStock({ ...outOfStockItem, availableQuantity: -2 })).toBe(true);
  });

  it("never flags a service or combo, which have no stock at all", () => {
    expect(isOutOfStock({ ...outOfStockItem, kind: "SPECIFIC", availableQuantity: null })).toBe(false);
    expect(isOutOfStock({ ...outOfStockItem, kind: "COMBO", availableQuantity: null })).toBe(false);
    expect(isOutOfStock({ ...outOfStockItem, kind: "PACKAGE", availableQuantity: null })).toBe(false);
  });

  it("refuses to resolve an out-of-stock item into a Parts Used row", () => {
    const result = resolveSelection(outOfStockItem, { hasPackageLine: false });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("out of stock");
  });

  it("still resolves an in-stock item", () => {
    const result = resolveSelection(inStockItem, { hasPackageLine: false });
    expect(result).toEqual({ ok: true, target: "PART", part: { inventoryItemId: "i2", quantityUsed: "1" } });
  });

  // The keyboard path: typing the full name and pressing Enter must hit the
  // same rule, not fall through to a custom line or a part row.
  it("blocks an out-of-stock item typed out in full", () => {
    const result = resolveTypedTerm([outOfStockItem, inStockItem], "Milaze tyre", { hasPackageLine: false });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("out of stock");
  });

  it("still lists out-of-stock items in search results, so staff can see they exist", () => {
    expect(searchCatalog([outOfStockItem, inStockItem], "tyr").map((e) => e.id)).toContain("i1");
  });
});
