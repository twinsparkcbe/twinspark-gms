import { describe, expect, it } from "vitest";

import type { InventoryItemRow } from "@/services/inventory";

import {
  FITTING_KEY,
  buildSalePickerIndex,
  isSaleEntryOutOfStock,
  resolveSaleSelection,
  resolveSaleTypedTerm,
  saleQuickPickEntries,
  salePickerKey,
  searchSaleCatalog,
  toSaleCustomCharge,
  type SalePickerEntry,
} from "./picker";

const TYRE = "33333333-3333-4333-8333-333333333301";

function item(overrides: Partial<InventoryItemRow> = {}): InventoryItemRow {
  return {
    id: TYRE,
    itemType: "BRAND_NEW_TYRE",
    productName: "Michelin Road 5",
    skuCode: "MICH-RD5-180",
    brandId: null,
    brandName: null,
    purchasePrice: 8000,
    sellingPrice: 11000,
    availableQuantity: 6,
    lowStockThreshold: 2,
    stockStatus: "in_stock",
    isActive: true,
    updatedAt: "2026-01-01T00:00:00.000Z",
    imageUrl: null,
    customTypeLabel: null,
    ...overrides,
  };
}

function index(overrides: { items?: InventoryItemRow[]; usageCounts?: Record<string, number> } = {}) {
  return buildSalePickerIndex({ items: overrides.items ?? [], usageCounts: overrides.usageCounts });
}

describe("buildSalePickerIndex", () => {
  it("includes active items and a synthetic Tyre Fitting entry", () => {
    const entries = index({ items: [item()] });

    expect(entries.map((e) => e.kind)).toEqual(["ITEM", "FITTING"]);
  });

  it("always offers Tyre Fitting, even with an empty catalog", () => {
    expect(index().map((e) => e.key)).toEqual([FITTING_KEY]);
  });

  it("prices the fitting entry at the confirmed ₹300 per wheel", () => {
    expect(index().find((e) => e.kind === "FITTING")?.rate).toBe(300);
  });

  it("excludes a deactivated item", () => {
    expect(index({ items: [item({ isActive: false })] }).some((e) => e.kind === "ITEM")).toBe(false);
  });

  it("keeps an out-of-stock item, carrying its quantity so the UI can flag it", () => {
    const entries = index({ items: [item({ availableQuantity: 0, stockStatus: "out_of_stock" })] });

    expect(entries.find((e) => e.kind === "ITEM")?.availableQuantity).toBe(0);
  });

  it("attaches usage counts by key, defaulting to zero", () => {
    const entries = index({ items: [item()], usageCounts: { [salePickerKey("ITEM", TYRE)]: 12 } });

    expect(entries.find((e) => e.kind === "ITEM")?.usageCount).toBe(12);
  });

  // Confirmed decision (2026-08-15): Combo Offers are never offered as a new
  // Sale Items addition — only an existing sale's already-recorded combo line
  // still displays (reconstructed straight from the sale, not from this index).
  it("never surfaces a COMBO entry, regardless of what's passed in", () => {
    const entries = index({ items: [item()] });

    expect(entries.some((e) => e.kind === "ITEM" || e.kind === "FITTING")).toBe(true);
    expect(entries.every((e) => (e.kind as string) !== "COMBO")).toBe(true);
  });
});

describe("searchSaleCatalog", () => {
  const entries = index({
    items: [item({ productName: "Michelin Road 5" }), item({ id: "i2", productName: "Rear Michelin Pilot", skuCode: "MICH-PLT-160" })],
  });

  it("matches case-insensitively", () => {
    expect(searchSaleCatalog(entries, "MICHELIN").length).toBe(2);
  });

  it("ranks a leading match above a mid-string one", () => {
    const names = searchSaleCatalog(entries, "michelin").map((e) => e.name);

    expect(names.indexOf("Michelin Road 5")).toBeLessThan(names.indexOf("Rear Michelin Pilot"));
  });

  it("finds an item by SKU, so a code can be typed or scanned", () => {
    expect(searchSaleCatalog(entries, "mich-plt").map((e) => e.name)).toEqual(["Rear Michelin Pilot"]);
  });

  it("finds tyre fitting by name, so it needs no separate button", () => {
    expect(searchSaleCatalog(entries, "fitting").map((e) => e.kind)).toEqual(["FITTING"]);
  });

  it("returns nothing for a blank or single-character term", () => {
    expect(searchSaleCatalog(entries, "")).toEqual([]);
    expect(searchSaleCatalog(entries, "m")).toEqual([]);
  });

  it("treats regex characters as literal text", () => {
    expect(() => searchSaleCatalog(entries, "road (")).not.toThrow();
  });

  // A combo can no longer surface, so typing its name finds nothing rather
  // than the bundle — confirms the removal reaches search, not just the index.
  it("finds no combo even when one used to exist by that name", () => {
    expect(searchSaleCatalog(entries, "weekend combo")).toEqual([]);
  });
});

describe("saleQuickPickEntries", () => {
  it("offers the shop's fastest-moving stock", () => {
    const entries = index({
      items: [item({ id: "a", productName: "Slow Tyre" }), item({ id: "b", productName: "Fast Tyre" })],
      usageCounts: { "ITEM:b": 40, "ITEM:a": 2 },
    });

    expect(saleQuickPickEntries(entries).map((e) => e.name)).toEqual(["Fast Tyre", "Slow Tyre"]);
  });

  it("leaves never-sold stock out, so the chip row isn't noise", () => {
    const entries = index({ items: [item({ productName: "Never Sold" })] });

    expect(saleQuickPickEntries(entries)).toEqual([]);
  });

  it("never chips tyre fitting — the nudge handles that", () => {
    const entries = index({ items: [item()], usageCounts: { [salePickerKey("ITEM", TYRE)]: 5 } });

    expect(saleQuickPickEntries(entries).some((e) => e.kind === "FITTING")).toBe(false);
  });

  it("respects the chip limit", () => {
    const entries = index({
      items: [item({ id: "a", productName: "A" }), item({ id: "b", productName: "B" }), item({ id: "c", productName: "C" })],
      usageCounts: { "ITEM:a": 3, "ITEM:b": 2, "ITEM:c": 1 },
    });

    expect(saleQuickPickEntries(entries, { limit: 2 })).toHaveLength(2);
  });
});

describe("resolveSaleSelection", () => {
  it("turns an item into a product line at quantity 1", () => {
    const entry = index({ items: [item()] }).find((e) => e.kind === "ITEM")!;

    expect(resolveSaleSelection(entry)).toEqual({ ok: true, target: "PRODUCT", product: { inventoryItemId: TYRE, quantity: "1" } });
  });

  it("pre-fills the wheel count from the tyres already on the sale", () => {
    const entry = index().find((e) => e.kind === "FITTING")!;

    expect(resolveSaleSelection(entry, { suggestedWheelCount: 2 })).toMatchObject({
      target: "FITTING",
      fitting: { installationSubtype: "TYRE_FITTING", wheelCount: "2" },
    });
  });

  it("leaves the wheel count blank when there are no tyres to infer from", () => {
    const entry = index().find((e) => e.kind === "FITTING")!;

    expect(resolveSaleSelection(entry)).toMatchObject({ fitting: { wheelCount: "" } });
  });
});

describe("toSaleCustomCharge / resolveSaleTypedTerm", () => {
  const entries = index({ items: [item({ productName: "Michelin Road 5" })] });

  it("turns free text into a one-off charge", () => {
    expect(toSaleCustomCharge("Number plate fitting")).toEqual({
      ok: true,
      target: "CUSTOM_CHARGE",
      charge: { installationSubtype: "CUSTOM", description: "Number plate fitting" },
    });
  });

  it("creates nothing from blank text", () => {
    expect(toSaleCustomCharge("   ").ok).toBe(false);
  });

  it("resolves an exact product name to that product, never a one-off charge", () => {
    expect(resolveSaleTypedTerm(entries, "michelin road 5")).toMatchObject({ target: "PRODUCT" });
  });

  it("resolves an exact 'Tyre Fitting' to the fitting line", () => {
    expect(resolveSaleTypedTerm(entries, "Tyre Fitting", { suggestedWheelCount: 2 })).toMatchObject({ target: "FITTING" });
  });

  it("falls back to a one-off charge when nothing matches", () => {
    expect(resolveSaleTypedTerm(entries, "Number plate fitting")).toMatchObject({ target: "CUSTOM_CHARGE" });
  });

  // A combo's own name is now just untyped text — same as any other unknown
  // term, it becomes a one-off charge rather than adding the bundle.
  it("turns a combo's name into a one-off charge rather than adding the bundle", () => {
    expect(resolveSaleTypedTerm(entries, "Weekend Combo")).toMatchObject({ target: "CUSTOM_CHARGE" });
  });
});

describe("out-of-stock products cannot be sold", () => {
  const outOfStock: SalePickerEntry = {
    key: "ITEM:i1",
    kind: "ITEM",
    id: "i1",
    name: "Milaze tyre",
    rate: 3100,
    availableQuantity: 0,
    skuCode: "TY-001",
    usageCount: 2,
  };
  const inStock: SalePickerEntry = { ...outOfStock, key: "ITEM:i2", id: "i2", name: "Track Tyre - Back", availableQuantity: 143 };

  it("flags a zero-stock product", () => {
    expect(isSaleEntryOutOfStock(outOfStock)).toBe(true);
    expect(isSaleEntryOutOfStock(inStock)).toBe(false);
  });

  it("refuses to resolve an out-of-stock product into a sale line", () => {
    const result = resolveSaleSelection(outOfStock);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("out of stock");
  });

  it("blocks it on the typed-in-full path too", () => {
    const result = resolveSaleTypedTerm([outOfStock, inStock], "Milaze tyre");
    expect(result.ok).toBe(false);
  });

  it("still resolves an in-stock product", () => {
    expect(resolveSaleSelection(inStock)).toEqual({
      ok: true,
      target: "PRODUCT",
      product: { inventoryItemId: "i2", quantity: "1" },
    });
  });
});
