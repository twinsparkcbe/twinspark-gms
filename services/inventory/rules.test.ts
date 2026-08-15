import { describe, expect, it } from "vitest";

import { deriveStatusCounts, deriveStockStatus, isSellingPriceBelowPurchase } from "./rules";

describe("deriveStatusCounts", () => {
  const stats = (overrides: Partial<Parameters<typeof deriveStatusCounts>[0]> = {}) => ({
    totalProducts: 268,
    lowStock: 4,
    outOfStock: 8,
    inventoryValueCost: 421500,
    ...overrides,
  });

  it("derives the in-stock count from the other three, with no extra query", () => {
    expect(deriveStatusCounts(stats()).inStock).toBe(256);
  });

  it("counts low plus out as the header's needs-attention figure", () => {
    expect(deriveStatusCounts(stats()).needsAttention).toBe(12);
  });

  it("reports every item as in stock for a healthy catalog", () => {
    const counts = deriveStatusCounts(stats({ lowStock: 0, outOfStock: 0 }));
    expect(counts).toMatchObject({ all: 268, inStock: 268, lowStock: 0, outOfStock: 0, needsAttention: 0 });
  });

  it("clamps in-stock at zero rather than going negative", () => {
    // The three counts come from three separate head-count queries; a sale
    // landing between them can briefly make low+out exceed the total. A chip
    // reading "-1" is worse than one reading "0" for a state that fixes
    // itself on the next refresh.
    expect(deriveStatusCounts(stats({ totalProducts: 10, lowStock: 6, outOfStock: 8 })).inStock).toBe(0);
  });
});

describe("deriveStockStatus", () => {
  // INV-047: quantity exactly at threshold is Low Stock.
  it("flags Low Stock when quantity equals the threshold", () => {
    expect(deriveStockStatus(5, 5)).toBe("low_stock");
  });

  // INV-048: quantity below threshold is Low Stock.
  it("flags Low Stock when quantity is below the threshold", () => {
    expect(deriveStockStatus(3, 5)).toBe("low_stock");
  });

  // INV-049: quantity above threshold is not flagged.
  it("flags In Stock when quantity is above the threshold", () => {
    expect(deriveStockStatus(10, 5)).toBe("in_stock");
  });

  // INV-050: quantity at zero is Out of Stock, distinct from Low Stock, even
  // if the threshold itself is 0.
  it("flags Out of Stock when quantity is zero, regardless of threshold", () => {
    expect(deriveStockStatus(0, 5)).toBe("out_of_stock");
    expect(deriveStockStatus(0, 0)).toBe("out_of_stock");
  });
});

describe("isSellingPriceBelowPurchase", () => {
  // INV-009: selling price below purchase price is a warning, not a block —
  // this helper is what the UI uses to decide whether to show that warning.
  it("returns true when selling price is below purchase price", () => {
    expect(isSellingPriceBelowPurchase(1000, 900)).toBe(true);
  });

  it("returns false when selling price is at or above purchase price", () => {
    expect(isSellingPriceBelowPurchase(1000, 1000)).toBe(false);
    expect(isSellingPriceBelowPurchase(1000, 1500)).toBe(false);
  });
});
