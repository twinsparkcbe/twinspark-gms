import { describe, expect, it } from "vitest";

import {
  saleInputSchema,
  saleLineInputSchema,
  saleReturnInputSchema,
  undoSaleReturnInputSchema,
  escalateSaleInputSchema,
} from "./schemas";

const VALID_ITEM_ID = "11111111-1111-1111-1111-111111111111";
const VALID_SALE_ITEM_ID = "22222222-2222-2222-2222-222222222222";
const VALID_SALE_ID = "33333333-3333-3333-3333-333333333333";
const VALID_SALE_RETURN_ID = "44444444-4444-4444-4444-444444444444";

function baseProductLine(overrides: Record<string, unknown> = {}) {
  return { lineType: "PRODUCT", inventoryItemId: VALID_ITEM_ID, quantity: 2, ...overrides };
}

function baseTyreFittingLine(overrides: Record<string, unknown> = {}) {
  return { lineType: "INSTALLATION", installationSubtype: "TYRE_FITTING", wheelCount: 2, ...overrides };
}

function baseCustomLine(overrides: Record<string, unknown> = {}) {
  return {
    lineType: "INSTALLATION",
    installationSubtype: "CUSTOM",
    description: "Chain Sprocket Kit Installation",
    amount: 250,
    ...overrides,
  };
}

describe("saleLineInputSchema — PRODUCT lines", () => {
  // SALE-005/006/007: Track Tyre, Brand New Tyre, and every other item type
  // all use the same shape (select item + quantity) — no item-type-specific
  // schema branching, matching the flat item picker (no category/brand
  // cascade at the schema/service layer).
  it("accepts a valid product line regardless of which item type it is", () => {
    expect(saleLineInputSchema.safeParse(baseProductLine()).success).toBe(true);
  });

  it("rejects a product line with no item selected", () => {
    const { inventoryItemId: _omit, ...rest } = baseProductLine();
    expect(saleLineInputSchema.safeParse(rest).success).toBe(false);
  });

  it.each([0, -1])("rejects a non-positive quantity (%i)", (quantity) => {
    expect(saleLineInputSchema.safeParse(baseProductLine({ quantity })).success).toBe(false);
  });

  it("rejects a non-integer quantity", () => {
    expect(saleLineInputSchema.safeParse(baseProductLine({ quantity: 1.5 })).success).toBe(false);
  });
});

describe("saleLineInputSchema — INSTALLATION lines", () => {
  // SALE-012: Tyre Fitting requires wheelCount.
  it("accepts a valid Tyre Fitting line with just wheelCount (amount is an optional override)", () => {
    expect(saleLineInputSchema.safeParse(baseTyreFittingLine()).success).toBe(true);
  });

  it("rejects Tyre Fitting with no wheelCount", () => {
    const { wheelCount: _omit, ...rest } = baseTyreFittingLine();
    expect(saleLineInputSchema.safeParse(rest).success).toBe(false);
  });

  // SALE-013: an explicit amount is accepted as a one-off override of the formula.
  it("accepts Tyre Fitting with an explicit amount override", () => {
    expect(saleLineInputSchema.safeParse(baseTyreFittingLine({ amount: 500 })).success).toBe(true);
  });

  // SALE-014: wheelCount independent of any product quantity — schema
  // doesn't cross-reference PRODUCT lines at all, any positive count works.
  it.each([1, 4])("accepts any positive wheelCount (%i), independent of tyres purchased", (wheelCount) => {
    expect(saleLineInputSchema.safeParse(baseTyreFittingLine({ wheelCount })).success).toBe(true);
  });

  // SALE-015: Custom requires description + manually entered amount, no formula.
  it("accepts a valid Custom installation line", () => {
    expect(saleLineInputSchema.safeParse(baseCustomLine()).success).toBe(true);
  });

  it("rejects Custom with no description", () => {
    const { description: _omit, ...rest } = baseCustomLine();
    expect(saleLineInputSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects Custom with a blank description", () => {
    expect(saleLineInputSchema.safeParse(baseCustomLine({ description: "   " })).success).toBe(false);
  });

  it("rejects Custom with no amount", () => {
    const { amount: _omit, ...rest } = baseCustomLine();
    expect(saleLineInputSchema.safeParse(rest).success).toBe(false);
  });

  // SALE-016: amount must be >= 0 on both subtypes.
  it("rejects a negative amount on a Custom line", () => {
    expect(saleLineInputSchema.safeParse(baseCustomLine({ amount: -10 })).success).toBe(false);
  });

  it("accepts a zero amount (free installation is valid)", () => {
    expect(saleLineInputSchema.safeParse(baseCustomLine({ amount: 0 })).success).toBe(true);
  });

  it("rejects an installation line with no installationSubtype", () => {
    expect(
      saleLineInputSchema.safeParse({ lineType: "INSTALLATION" }).success
    ).toBe(false);
  });

  // SALE-017: installedBy is optional on both subtypes.
  it("accepts installedBy when provided, and omits fine without it", () => {
    expect(saleLineInputSchema.safeParse(baseTyreFittingLine({ installedBy: "Ravi" })).success).toBe(true);
    expect(saleLineInputSchema.safeParse(baseTyreFittingLine()).success).toBe(true);
  });
});

describe("saleInputSchema", () => {
  function baseSaleInput(overrides: Record<string, unknown> = {}) {
    return {
      customerName: "Arun Kumar",
      customerMobile: "9876543210",
      gstApplicable: false,
      gstAmount: 0,
      discountApplicable: false,
      discountAmount: 0,
      lines: [baseProductLine()],
      payment: { mode: "CASH", cashAmount: 0, upiAmount: 0 },
      ...overrides,
    };
  }

  it("accepts a valid sale with one product line", () => {
    expect(saleInputSchema.safeParse(baseSaleInput()).success).toBe(true);
  });

  it("accepts a sale mixing product and installation lines", () => {
    const result = saleInputSchema.safeParse(
      baseSaleInput({ lines: [baseProductLine(), baseTyreFittingLine(), baseCustomLine()] })
    );
    expect(result.success).toBe(true);
  });

  it("PAY-062: the payment block is required — omitting it is an error, not a silent PAID", () => {
    const { payment: _p, ...rest } = baseSaleInput();
    expect(saleInputSchema.safeParse(rest).success).toBe(false);
  });

  it("PAY-060: accepts a split payment's two amounts", () => {
    const result = saleInputSchema.safeParse(
      baseSaleInput({ payment: { mode: "SPLIT", cashAmount: 1000, upiAmount: 1000 } })
    );
    expect(result.success).toBe(true);
  });

  it("PAY-061: rejects a negative amount", () => {
    const result = saleInputSchema.safeParse(
      baseSaleInput({ payment: { mode: "CASH", cashAmount: -1, upiAmount: 0 } })
    );
    expect(result.success).toBe(false);
  });

  it("PAY-063: rejects an unknown payment mode", () => {
    const result = saleInputSchema.safeParse(
      baseSaleInput({ payment: { mode: "CARD", cashAmount: 0, upiAmount: 0 } })
    );
    expect(result.success).toBe(false);
  });

  it("PAY-063b: accepts a null mode — that's how 'not paid yet' is expressed", () => {
    const result = saleInputSchema.safeParse(
      baseSaleInput({ payment: { mode: null, cashAmount: 0, upiAmount: 0 } })
    );
    expect(result.success).toBe(true);
  });

  it("PAY-064: coerces the numeric strings that arrive from text inputs", () => {
    const result = saleInputSchema.safeParse(
      baseSaleInput({ payment: { mode: "SPLIT", cashAmount: "1000", upiAmount: "1000" } })
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.payment.cashAmount).toBe(1000);
  });

  // SALE-011: at least one product line required.
  it("rejects a sale with zero lines", () => {
    expect(saleInputSchema.safeParse(baseSaleInput({ lines: [] })).success).toBe(false);
  });

  it("rejects a sale with only installation lines, no product", () => {
    expect(saleInputSchema.safeParse(baseSaleInput({ lines: [baseTyreFittingLine()] })).success).toBe(false);
  });

  it("requires a customer name", () => {
    const { customerName: _omit, ...rest } = baseSaleInput();
    expect(saleInputSchema.safeParse(rest).success).toBe(false);
  });

  it("requires a plausible mobile number", () => {
    expect(saleInputSchema.safeParse(baseSaleInput({ customerMobile: "123" })).success).toBe(false);
  });

  // SALE-021/022: GST/discount are optional (default false/0).
  it("defaults gstApplicable/discountApplicable to false when omitted", () => {
    const { gstApplicable: _g, discountApplicable: _d, ...rest } = baseSaleInput();
    const result = saleInputSchema.parse(rest);
    expect(result.gstApplicable).toBe(false);
    expect(result.discountApplicable).toBe(false);
  });

  it.each([-1])("rejects a negative GST amount (%i)", (gstAmount) => {
    expect(saleInputSchema.safeParse(baseSaleInput({ gstApplicable: true, gstAmount })).success).toBe(false);
  });

  // SALE-023 (schema half — grand total clamping is a UI/service concern):
  // a negative discount is rejected outright, same rule as GST.
  it.each([-1])("rejects a negative discount amount (%i)", (discountAmount) => {
    expect(
      saleInputSchema.safeParse(baseSaleInput({ discountApplicable: true, discountAmount })).success
    ).toBe(false);
  });
});

describe("saleReturnInputSchema", () => {
  function baseReturnInput(overrides: Record<string, unknown> = {}) {
    return { saleItemId: VALID_SALE_ITEM_ID, quantity: 1, reason: "Customer changed their mind", ...overrides };
  }

  // SALE-034: reason required.
  it("accepts a valid return", () => {
    expect(saleReturnInputSchema.safeParse(baseReturnInput()).success).toBe(true);
  });

  it.each([0, -1])("rejects a non-positive quantity (%i)", (quantity) => {
    expect(saleReturnInputSchema.safeParse(baseReturnInput({ quantity })).success).toBe(false);
  });

  it.each(["", "   "])("rejects a blank reason (%j)", (reason) => {
    expect(saleReturnInputSchema.safeParse(baseReturnInput({ reason })).success).toBe(false);
  });
});

describe("undoSaleReturnInputSchema", () => {
  function baseUndoInput(overrides: Record<string, unknown> = {}) {
    return { saleReturnId: VALID_SALE_RETURN_ID, reason: "Entered against the wrong item by mistake", ...overrides };
  }

  // UNDO-001: valid input accepted.
  it("accepts a valid input", () => {
    expect(undoSaleReturnInputSchema.safeParse(baseUndoInput()).success).toBe(true);
  });

  // UNDO-002: non-uuid saleReturnId rejected.
  it("rejects a non-uuid saleReturnId", () => {
    expect(undoSaleReturnInputSchema.safeParse(baseUndoInput({ saleReturnId: "not-a-uuid" })).success).toBe(false);
  });

  // UNDO-003: blank/whitespace-only reason rejected.
  it.each(["", "   "])("rejects a blank reason (%j)", (reason) => {
    expect(undoSaleReturnInputSchema.safeParse(baseUndoInput({ reason })).success).toBe(false);
  });

  // UNDO-004: missing reason entirely rejected.
  it("rejects a missing reason", () => {
    const { reason: _omit, ...rest } = baseUndoInput();
    expect(undoSaleReturnInputSchema.safeParse(rest).success).toBe(false);
  });
});

describe("escalateSaleInputSchema", () => {
  // SALE-037: note is optional.
  it("accepts with and without a note", () => {
    expect(escalateSaleInputSchema.safeParse({ saleId: VALID_SALE_ID }).success).toBe(true);
    expect(
      escalateSaleInputSchema.safeParse({ saleId: VALID_SALE_ID, note: "Wheel bearing looked worn" }).success
    ).toBe(true);
  });

  it("rejects an invalid saleId", () => {
    expect(escalateSaleInputSchema.safeParse({ saleId: "not-a-uuid" }).success).toBe(false);
  });
});
