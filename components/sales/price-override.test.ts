import { describe, expect, it } from "vitest";

import type { InventoryItemRow } from "@/services/inventory";

import { effectiveUnitPrice, lineDiscount, lineTotal } from "./sale-line-items";
import type { LineDraft } from "./sale-line-items";

function item(overrides: Partial<InventoryItemRow> = {}): InventoryItemRow {
  return {
    id: "item-1",
    itemType: "BRAND_NEW_TYRE",
    productName: "Alpha H1 110/70",
    skuCode: "TYR-9001",
    brandId: "b1",
    brandName: "Apollo",
    purchasePrice: 4450,
    sellingPrice: 5300,
    availableQuantity: 20,
    lowStockThreshold: 5,
    stockStatus: "in_stock",
    isActive: true,
    imageUrl: null,
    customTypeLabel: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  } as InventoryItemRow;
}

function line(overrides: Partial<Extract<LineDraft, { lineType: "PRODUCT" }>> = {}): LineDraft {
  return { id: "l1", lineType: "PRODUCT", inventoryItemId: "item-1", quantity: "1", ...overrides } as LineDraft;
}

const ITEMS = [item()];

describe("effectiveUnitPrice", () => {
  it("uses the catalogue price when nothing has been negotiated", () => {
    expect(effectiveUnitPrice(line(), item())).toBe(5300);
    expect(effectiveUnitPrice(line({ unitPrice: "" }), item())).toBe(5300);
    expect(effectiveUnitPrice(line({ unitPrice: "   " }), item())).toBe(5300);
  });

  it("uses the negotiated price once one is typed", () => {
    expect(effectiveUnitPrice(line({ unitPrice: "5000" }), item())).toBe(5000);
    expect(effectiveUnitPrice(line({ unitPrice: "5000.50" }), item())).toBe(5000.5);
  });

  /** Mid-typing the field is briefly "0", "." or empty — the row must not
   * flash a zero-rupee bill while the user is still entering a number. */
  it("falls back to the catalogue price for a half-typed or invalid value", () => {
    expect(effectiveUnitPrice(line({ unitPrice: "0" }), item())).toBe(5300);
    expect(effectiveUnitPrice(line({ unitPrice: "." }), item())).toBe(5300);
    expect(effectiveUnitPrice(line({ unitPrice: "-100" }), item())).toBe(5300);
  });

  it("allows a price above the catalogue — an upcharge is legitimate", () => {
    expect(effectiveUnitPrice(line({ unitPrice: "5500" }), item())).toBe(5500);
  });
});

describe("lineTotal with a negotiated price", () => {
  it("multiplies the negotiated price by quantity, not the catalogue price", () => {
    expect(lineTotal(line({ unitPrice: "5000", quantity: "2" }), ITEMS)).toBe(10000);
  });

  it("is unchanged when no price was negotiated", () => {
    expect(lineTotal(line({ quantity: "2" }), ITEMS)).toBe(10600);
  });
});

describe("lineDiscount", () => {
  it("is the per-unit gap times quantity", () => {
    expect(lineDiscount(line({ unitPrice: "5000", quantity: "2" }), ITEMS)).toBe(600);
  });

  it("is zero at the catalogue price", () => {
    expect(lineDiscount(line({ quantity: "3" }), ITEMS)).toBe(0);
  });

  /** "Discount given" must never read negative — an upcharge is not a
   * negative discount, it is simply no discount. */
  it("is zero, not negative, for an upcharge", () => {
    expect(lineDiscount(line({ unitPrice: "5500", quantity: "2" }), ITEMS)).toBe(0);
  });

  it("is zero for a line with no item chosen yet", () => {
    expect(lineDiscount(line({ inventoryItemId: null, unitPrice: "5000" }), ITEMS)).toBe(0);
  });

  it("ignores non-product lines", () => {
    const fitting = { id: "f", lineType: "INSTALLATION", installationSubtype: "TYRE_FITTING", wheelCount: "2", amount: "", description: "", installedBy: "" } as unknown as LineDraft;
    expect(lineDiscount(fitting, ITEMS)).toBe(0);
  });
});
