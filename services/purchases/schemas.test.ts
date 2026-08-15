import { describe, expect, it } from "vitest";

import {
  newItemWithPurchaseInputSchema,
  purchaseEntryEditInputSchema,
  purchaseEntryFiltersSchema,
  purchaseEntryInputSchema,
  purchaseReturnInputSchema,
} from "./schemas";

const VALID_ITEM_ID = "11111111-1111-1111-1111-111111111111";
const VALID_ENTRY_ID = "22222222-2222-2222-2222-222222222222";
const VALID_BRAND_ID = "b1111111-1111-1111-1111-111111111111";

function baseEntryInput(overrides: Record<string, unknown> = {}) {
  return {
    inventoryItemId: VALID_ITEM_ID,
    quantity: 10,
    unitPrice: 1250,
    sellingPrice: 1500,
    purchaseDate: new Date(),
    ...overrides,
  };
}

describe("purchaseEntryInputSchema", () => {
  // PUR-001
  it("accepts a valid purchase entry, supplierName/note optional", () => {
    const result = purchaseEntryInputSchema.safeParse(baseEntryInput());
    expect(result.success).toBe(true);
  });

  it("accepts an explicit supplierName and note", () => {
    const result = purchaseEntryInputSchema.safeParse(
      baseEntryInput({ supplierName: "ABC Tyre Distributors", note: "Monthly restock" })
    );
    expect(result.success).toBe(true);
  });

  // PUR-002
  it.each([0, -5])("rejects a non-positive quantity (%i)", (quantity) => {
    const result = purchaseEntryInputSchema.safeParse(baseEntryInput({ quantity }));
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer quantity", () => {
    const result = purchaseEntryInputSchema.safeParse(baseEntryInput({ quantity: 2.5 }));
    expect(result.success).toBe(false);
  });

  // PUR-003
  it.each([0, -100])("rejects a non-positive unit price (%i)", (unitPrice) => {
    const result = purchaseEntryInputSchema.safeParse(baseEntryInput({ unitPrice }));
    expect(result.success).toBe(false);
  });

  // REQ-01: sellingPrice is required — no more optional override/fallback
  // (0011_purchases_item_ownership.sql).
  it.each([0, -100])("rejects a non-positive selling price (%i)", (sellingPrice) => {
    const result = purchaseEntryInputSchema.safeParse(baseEntryInput({ sellingPrice }));
    expect(result.success).toBe(false);
  });

  it("rejects a missing selling price", () => {
    const { sellingPrice: _omit, ...rest } = baseEntryInput();
    const result = purchaseEntryInputSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  // PUR-004
  it("rejects a purchase date in the future", () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const result = purchaseEntryInputSchema.safeParse(baseEntryInput({ purchaseDate: future }));
    expect(result.success).toBe(false);
  });

  it("accepts a past purchase date (backdated entry)", () => {
    const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = purchaseEntryInputSchema.safeParse(baseEntryInput({ purchaseDate: past }));
    expect(result.success).toBe(true);
  });

  it("rejects an invalid item id", () => {
    const result = purchaseEntryInputSchema.safeParse(baseEntryInput({ inventoryItemId: "not-a-uuid" }));
    expect(result.success).toBe(false);
  });
});

describe("purchaseEntryEditInputSchema", () => {
  function baseEditInput(overrides: Record<string, unknown> = {}) {
    return {
      quantity: 40,
      unitPrice: 1300,
      sellingPrice: 1600,
      purchaseDate: new Date(),
      ...overrides,
    };
  }

  it("accepts a valid edit input, no inventoryItemId required", () => {
    const result = purchaseEntryEditInputSchema.safeParse(baseEditInput());
    expect(result.success).toBe(true);
  });

  it.each([0, -5])("rejects a non-positive quantity (%i)", (quantity) => {
    expect(purchaseEntryEditInputSchema.safeParse(baseEditInput({ quantity })).success).toBe(false);
  });

  it.each([0, -100])("rejects a non-positive unit price (%i)", (unitPrice) => {
    expect(purchaseEntryEditInputSchema.safeParse(baseEditInput({ unitPrice })).success).toBe(false);
  });

  it.each([0, -100])("rejects a non-positive selling price (%i)", (sellingPrice) => {
    expect(purchaseEntryEditInputSchema.safeParse(baseEditInput({ sellingPrice })).success).toBe(false);
  });

  it("rejects a missing selling price", () => {
    const { sellingPrice: _omit, ...rest } = baseEditInput();
    expect(purchaseEntryEditInputSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a purchase date in the future", () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    expect(purchaseEntryEditInputSchema.safeParse(baseEditInput({ purchaseDate: future })).success).toBe(false);
  });

  it("accepts an explicit supplierName and note", () => {
    const result = purchaseEntryEditInputSchema.safeParse(
      baseEditInput({ supplierName: "ABC Tyre Distributors", note: "Fixed a typo in the price" })
    );
    expect(result.success).toBe(true);
  });
});

describe("purchaseReturnInputSchema", () => {
  function baseReturnInput(overrides: Record<string, unknown> = {}) {
    return {
      purchaseEntryId: VALID_ENTRY_ID,
      quantity: 2,
      reason: "Defective batch",
      ...overrides,
    };
  }

  it("accepts a valid return", () => {
    expect(purchaseReturnInputSchema.safeParse(baseReturnInput()).success).toBe(true);
  });

  // PUR-016
  it.each([0, -1])("rejects a non-positive quantity (%i)", (quantity) => {
    expect(purchaseReturnInputSchema.safeParse(baseReturnInput({ quantity })).success).toBe(false);
  });

  // PUR-015
  it.each(["", "   "])("rejects a blank reason (%j)", (reason) => {
    expect(purchaseReturnInputSchema.safeParse(baseReturnInput({ reason })).success).toBe(false);
  });

  it("requires reason to be present at all", () => {
    const { reason: _omit, ...rest } = baseReturnInput();
    expect(purchaseReturnInputSchema.safeParse(rest).success).toBe(false);
  });
});

describe("newItemWithPurchaseInputSchema", () => {
  function baseNewItemInput(overrides: Record<string, unknown> = {}) {
    return {
      itemType: "TRACK_TYRE",
      productName: "MRF Nylogrip Zapper 100/90-17",
      brandId: VALID_BRAND_ID,
      lowStockThreshold: 5,
      quantity: 50,
      unitPrice: 1000,
      sellingPrice: 1400,
      purchaseDate: new Date(),
      ...overrides,
    };
  }

  it("accepts a valid new-item-with-purchase input", () => {
    expect(newItemWithPurchaseInputSchema.safeParse(baseNewItemInput()).success).toBe(true);
  });

  it("requires a brand", () => {
    const { brandId: _brandId, ...rest } = baseNewItemInput();
    expect(newItemWithPurchaseInputSchema.safeParse(rest).success).toBe(false);
  });

  it("requires a positive quantity", () => {
    expect(newItemWithPurchaseInputSchema.safeParse(baseNewItemInput({ quantity: 0 })).success).toBe(false);
  });

  it("requires a positive selling price", () => {
    expect(newItemWithPurchaseInputSchema.safeParse(baseNewItemInput({ sellingPrice: 0 })).success).toBe(
      false
    );
  });

  it("requires customTypeLabel for Other Spare Part", () => {
    const result = newItemWithPurchaseInputSchema.safeParse(
      baseNewItemInput({ itemType: "OTHER_SPARE_PART" })
    );
    expect(result.success).toBe(false);
  });

  it("accepts Other Spare Part with customTypeLabel set", () => {
    const result = newItemWithPurchaseInputSchema.safeParse(
      baseNewItemInput({ itemType: "OTHER_SPARE_PART", customTypeLabel: "Helmet Lock" })
    );
    expect(result.success).toBe(true);
  });

  it("rejects a purchase date in the future", () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const result = newItemWithPurchaseInputSchema.safeParse(baseNewItemInput({ purchaseDate: future }));
    expect(result.success).toBe(false);
  });
});

describe("purchaseEntryFiltersSchema", () => {
  // PUR-009
  it("defaults page to 1 and pageSize to 20 when omitted", () => {
    const result = purchaseEntryFiltersSchema.parse({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });

  it("caps pageSize at 100", () => {
    const result = purchaseEntryFiltersSchema.safeParse({ pageSize: 500 });
    expect(result.success).toBe(false);
  });

  // PUR-010
  it("accepts itemTypes, brandIds, and a date range together", () => {
    const result = purchaseEntryFiltersSchema.safeParse({
      itemTypes: ["TRACK_TYRE", "ENGINE_OIL"],
      brandIds: [VALID_ITEM_ID],
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
    });
    expect(result.success).toBe(true);
  });

  // PUR-011
  it("only accepts a known sort value", () => {
    expect(purchaseEntryFiltersSchema.safeParse({ sortBy: "amount" }).success).toBe(true);
    expect(purchaseEntryFiltersSchema.safeParse({ sortBy: "bogus" }).success).toBe(false);
  });
});
