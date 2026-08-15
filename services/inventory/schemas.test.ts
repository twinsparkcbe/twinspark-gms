import { describe, expect, it } from "vitest";

import {
  brandInputSchema,
  inventoryItemInputSchema,
  itemDetailsInputSchema,
  stockAdjustmentInputSchema,
} from "./schemas";

const baseTrackTyre = {
  itemType: "TRACK_TYRE" as const,
  productName: "MRF Nylogrip Zapper 100/90-17",
  skuCode: "MRF-ZAP-100-90-17",
  brandId: "b1111111-1111-1111-1111-111111111111",
  purchasePrice: 1500,
  sellingPrice: 2200,
  lowStockThreshold: 5,
};

describe("inventoryItemInputSchema — brand is required for every item type", () => {
  // Category was removed entirely and Brand is no longer exclusive to Brand
  // New Tyre — every item type now requires a brand.
  it("accepts a Track Tyre with brandId set", () => {
    const result = inventoryItemInputSchema.safeParse(baseTrackTyre);
    expect(result.success).toBe(true);
  });

  it("rejects a Track Tyre with no brandId", () => {
    const { brandId: _brandId, ...withoutBrand } = baseTrackTyre;
    const result = inventoryItemInputSchema.safeParse(withoutBrand);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("brandId"))).toBe(true);
    }
  });

  it("rejects an Engine Oil with no brandId", () => {
    const { brandId: _brandId, ...withoutBrand } = baseTrackTyre;
    const result = inventoryItemInputSchema.safeParse({
      ...withoutBrand,
      itemType: "ENGINE_OIL",
      productName: "Motul 7100 10W40 1L",
      skuCode: "MOTUL-7100-1L",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("brandId"))).toBe(true);
    }
  });

  it("accepts a Brand New Tyre with brandId set (no category needed anymore)", () => {
    const result = inventoryItemInputSchema.safeParse({
      ...baseTrackTyre,
      itemType: "BRAND_NEW_TYRE",
    });
    expect(result.success).toBe(true);
  });
});

describe("inventoryItemInputSchema — pricing rules", () => {
  // INV-008: purchase/selling price must be > 0.
  it("rejects purchase price of 0", () => {
    const result = inventoryItemInputSchema.safeParse({ ...baseTrackTyre, purchasePrice: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects selling price of 0", () => {
    const result = inventoryItemInputSchema.safeParse({ ...baseTrackTyre, sellingPrice: 0 });
    expect(result.success).toBe(false);
  });

  // INV-009: selling price below purchase price is NOT blocked by the schema
  // — it's allowed through, and flagged as a UI warning separately (see
  // rules.test.ts / isSellingPriceBelowPurchase).
  it("allows selling price below purchase price (warning, not a block)", () => {
    const result = inventoryItemInputSchema.safeParse({
      ...baseTrackTyre,
      purchasePrice: 1000,
      sellingPrice: 900,
    });
    expect(result.success).toBe(true);
  });

  // INV-010: non-numeric price is rejected.
  it("rejects a non-numeric price", () => {
    const result = inventoryItemInputSchema.safeParse({ ...baseTrackTyre, purchasePrice: "abc" });
    expect(result.success).toBe(false);
  });
});

describe("inventoryItemInputSchema — other validation", () => {
  // INV-053: low_stock_threshold cannot be negative.
  it("rejects a negative low stock threshold", () => {
    const result = inventoryItemInputSchema.safeParse({ ...baseTrackTyre, lowStockThreshold: -1 });
    expect(result.success).toBe(false);
  });

  it("allows a low stock threshold of 0", () => {
    const result = inventoryItemInputSchema.safeParse({ ...baseTrackTyre, lowStockThreshold: 0 });
    expect(result.success).toBe(true);
  });

  // INV-054: required fields block submission.
  it("rejects an empty product name", () => {
    const result = inventoryItemInputSchema.safeParse({ ...baseTrackTyre, productName: "" });
    expect(result.success).toBe(false);
  });

  // SKU / Code is now optional — left blank, the server auto-generates one
  // (see items.test.ts) — so the schema itself must accept it missing.
  it("accepts an empty SKU/code (auto-generated on create if left blank)", () => {
    const result = inventoryItemInputSchema.safeParse({ ...baseTrackTyre, skuCode: "" });
    expect(result.success).toBe(true);
  });

  it("accepts skuCode omitted entirely", () => {
    const { skuCode: _skuCode, ...withoutSku } = baseTrackTyre;
    const result = inventoryItemInputSchema.safeParse(withoutSku);
    expect(result.success).toBe(true);
  });
});

describe("inventoryItemInputSchema — Other Spare Part custom type label", () => {
  const baseOther = {
    ...baseTrackTyre,
    itemType: "OTHER_SPARE_PART" as const,
    productName: "Helmet Lock",
    skuCode: "HL-001",
  };

  it("accepts Other Spare Part with a customTypeLabel set", () => {
    const result = inventoryItemInputSchema.safeParse({ ...baseOther, customTypeLabel: "Helmet Lock" });
    expect(result.success).toBe(true);
  });

  it("rejects Other Spare Part with no customTypeLabel", () => {
    const result = inventoryItemInputSchema.safeParse(baseOther);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("customTypeLabel"))).toBe(true);
    }
  });

  it("rejects Other Spare Part with an empty/whitespace customTypeLabel", () => {
    const result = inventoryItemInputSchema.safeParse({ ...baseOther, customTypeLabel: "   " });
    expect(result.success).toBe(false);
  });

  it("rejects a non-Other-Spare-Part type that still has customTypeLabel set", () => {
    const result = inventoryItemInputSchema.safeParse({
      ...baseTrackTyre,
      customTypeLabel: "Should not be here",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("customTypeLabel"))).toBe(true);
    }
  });

  // Other Spare Part still needs a brand too — the custom label requirement
  // is additive, not a replacement for the universal brand rule.
  it("rejects Other Spare Part with customTypeLabel but no brandId", () => {
    const { brandId: _brandId, ...withoutBrand } = baseOther;
    const result = inventoryItemInputSchema.safeParse({
      ...withoutBrand,
      customTypeLabel: "Helmet Lock",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("brandId"))).toBe(true);
    }
  });
});

describe("stockAdjustmentInputSchema", () => {
  const base = {
    itemId: "11111111-1111-1111-1111-111111111111",
    delta: -2,
    reasonLabel: "Damaged" as const,
    note: "2 units damaged in transit",
  };

  // INV-039/042/043: positive and negative adjustments both accepted.
  it("accepts a negative adjustment", () => {
    expect(stockAdjustmentInputSchema.safeParse(base).success).toBe(true);
  });

  it("accepts a positive adjustment", () => {
    expect(stockAdjustmentInputSchema.safeParse({ ...base, delta: 3 }).success).toBe(true);
  });

  // INV-040: reason is required.
  it("rejects a missing/invalid reason", () => {
    const result = stockAdjustmentInputSchema.safeParse({ ...base, reasonLabel: "Not a real reason" });
    expect(result.success).toBe(false);
  });

  // doc/inventory-purchase-simplification-scope.md §2.2: all 7 expanded
  // reason labels are valid.
  it.each([
    "Damaged",
    "Manufacturing Defect",
    "Lost/Missing",
    "Customer Return",
    "Supplier Return",
    "Manual Correction",
  ] as const)("accepts '%s' as a valid reason", (reasonLabel) => {
    const result = stockAdjustmentInputSchema.safeParse({ ...base, reasonLabel });
    expect(result.success).toBe(true);
  });

  // "Opening Stock" and "Stock-take correction"/"Damage/Write-off" no longer
  // exist — item creation always comes with an opening batch via Purchases
  // now, and the reason list was renamed/expanded (§2.2).
  it("rejects the retired 'Opening Stock' reason", () => {
    const result = stockAdjustmentInputSchema.safeParse({ ...base, reasonLabel: "Opening Stock" });
    expect(result.success).toBe(false);
  });

  // INV-041/note is optional at the schema level now for every reason — the
  // reason label itself always gets logged regardless (see toLoggedNote in
  // stock-adjustment.ts).
  it("allows an empty note for Damaged (note is optional)", () => {
    const result = stockAdjustmentInputSchema.safeParse({ ...base, note: "" });
    expect(result.success).toBe(true);
  });

  it("allows an empty note for Manual Correction (note is optional)", () => {
    const result = stockAdjustmentInputSchema.safeParse({
      ...base,
      reasonLabel: "Manual Correction",
      note: "",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a zero-value adjustment", () => {
    const result = stockAdjustmentInputSchema.safeParse({ ...base, delta: 0 });
    expect(result.success).toBe(false);
  });

  // FIFO batch tracking (0010_purchase_batch_fifo.sql): unitCost only makes
  // sense alongside a positive delta (a new synthetic batch).
  it("accepts unitCost alongside a positive delta", () => {
    const result = stockAdjustmentInputSchema.safeParse({
      ...base,
      reasonLabel: "Manual Correction",
      delta: 10,
      unitCost: 950,
    });
    expect(result.success).toBe(true);
  });

  it("rejects unitCost alongside a negative delta", () => {
    const result = stockAdjustmentInputSchema.safeParse({ ...base, delta: -2, unitCost: 950 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("unitCost"))).toBe(true);
    }
  });

  it("allows a positive delta with unitCost omitted (falls back server-side)", () => {
    const result = stockAdjustmentInputSchema.safeParse({
      ...base,
      reasonLabel: "Manual Correction",
      delta: 10,
    });
    expect(result.success).toBe(true);
  });

  // "Other" requires a customReason describing what it actually is, so the
  // audit trail doesn't just say the generic word "Other".
  it("rejects 'Other' with no customReason", () => {
    const result = stockAdjustmentInputSchema.safeParse({
      ...base,
      reasonLabel: "Other",
      note: "Some detail",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("customReason"))).toBe(true);
    }
  });

  it("accepts 'Other' with a customReason set", () => {
    const result = stockAdjustmentInputSchema.safeParse({
      ...base,
      reasonLabel: "Other",
      customReason: "Vendor return",
      note: "Returned a defective unit",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a customReason set for any non-'Other' reason", () => {
    const result = stockAdjustmentInputSchema.safeParse({
      ...base,
      reasonLabel: "Manual Correction",
      customReason: "Should not be here",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("customReason"))).toBe(true);
    }
  });
});

describe("itemDetailsInputSchema", () => {
  const base = {
    itemType: "TRACK_TYRE" as const,
    productName: "MRF Nylogrip Zapper 100/90-17",
    skuCode: "MRF-ZAP-100-90-17",
    brandId: "b1111111-1111-1111-1111-111111111111",
    lowStockThreshold: 5,
  };

  it("accepts valid master data with no price fields", () => {
    expect(itemDetailsInputSchema.safeParse(base).success).toBe(true);
  });

  // The whole point of this schema (doc/inventory-purchase-simplification-
  // scope.md §1.2) is that it has NO price fields to send — verify the
  // parsed value doesn't grow one even if a caller sneaks it into the input.
  it("strips any purchasePrice/sellingPrice sent alongside valid fields", () => {
    const result = itemDetailsInputSchema.safeParse({ ...base, purchasePrice: 999, sellingPrice: 999 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("purchasePrice");
      expect(result.data).not.toHaveProperty("sellingPrice");
    }
  });

  it("requires a brand", () => {
    const { brandId: _brandId, ...withoutBrand } = base;
    expect(itemDetailsInputSchema.safeParse(withoutBrand).success).toBe(false);
  });

  it("requires customTypeLabel for Other Spare Part", () => {
    const result = itemDetailsInputSchema.safeParse({ ...base, itemType: "OTHER_SPARE_PART" });
    expect(result.success).toBe(false);
  });

  it("accepts Other Spare Part with customTypeLabel set", () => {
    const result = itemDetailsInputSchema.safeParse({
      ...base,
      itemType: "OTHER_SPARE_PART",
      customTypeLabel: "Helmet Lock",
    });
    expect(result.success).toBe(true);
  });
});

describe("brandInputSchema", () => {
  it("requires a non-empty brand name", () => {
    expect(brandInputSchema.safeParse({ name: "", itemType: "BRAND_NEW_TYRE" }).success).toBe(false);
    expect(brandInputSchema.safeParse({ name: "Michelin", itemType: "BRAND_NEW_TYRE" }).success).toBe(true);
  });

  it("requires a valid item type", () => {
    expect(brandInputSchema.safeParse({ name: "Michelin" }).success).toBe(false);
    expect(brandInputSchema.safeParse({ name: "Michelin", itemType: "NOPE" }).success).toBe(false);
  });
});
