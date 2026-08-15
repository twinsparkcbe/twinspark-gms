import { describe, expect, it } from "vitest";

import { computeServiceJobTotals, roundMoney, serviceLineAmount, type ServiceJobTotalsInput } from "./totals";

const PRICES: Record<string, number> = {
  "item-oil": 450,
  "item-filter": 250,
};

function totals(overrides: Partial<ServiceJobTotalsInput> = {}) {
  return computeServiceJobTotals({
    lines: [],
    parts: [],
    prices: { sellingPriceOf: (id) => PRICES[id] },
    gstApplicable: false,
    gstPercent: "18",
    discountApplicable: false,
    discountAmount: "",
    ...overrides,
  });
}

describe("serviceLineAmount", () => {
  it("multiplies quantity by rate", () => {
    expect(serviceLineAmount({ quantity: "2", rate: "350" })).toBe(700);
  });

  it("truncates a fractional quantity — lines are whole units", () => {
    expect(serviceLineAmount({ quantity: "2.9", rate: "100" })).toBe(200);
  });

  it("reads a blank rate as zero rather than NaN", () => {
    expect(serviceLineAmount({ quantity: "1", rate: "" })).toBe(0);
  });
});

describe("computeServiceJobTotals", () => {
  it("sums quantity × rate across all service lines", () => {
    const result = totals({
      lines: [
        { quantity: "1", rate: "850" },
        { quantity: "2", rate: "200" },
      ],
    });

    expect(result.subtotal).toBe(1250);
  });

  it("prices parts at selling price — purchase price never enters a service total", () => {
    const result = totals({ parts: [{ inventoryItemId: "item-oil", quantityUsed: "2" }] });

    expect(result.partsTotal).toBe(900); // 450 selling × 2, not 300 purchase
  });

  it("computes GST on services and parts combined", () => {
    const result = totals({
      lines: [{ quantity: "1", rate: "1000" }],
      parts: [{ inventoryItemId: "item-filter", quantityUsed: "1" }],
      gstApplicable: true,
      gstPercent: "18",
    });

    expect(result.taxableTotal).toBe(1250);
    expect(result.gstAmount).toBe(225);
  });

  it("applies no GST when the checkbox is off, even with a percent still in the field", () => {
    const result = totals({ lines: [{ quantity: "1", rate: "1000" }], gstApplicable: false, gstPercent: "18" });

    expect(result.gstAmount).toBe(0);
    expect(result.grandTotal).toBe(1000);
  });

  it("subtracts the discount after GST", () => {
    const result = totals({
      lines: [{ quantity: "1", rate: "1000" }],
      gstApplicable: true,
      gstPercent: "18",
      discountApplicable: true,
      discountAmount: "100",
    });

    expect(result.grandTotal).toBe(1080); // 1000 + 180 − 100
  });

  it("ignores the discount amount when the checkbox is off", () => {
    const result = totals({ lines: [{ quantity: "1", rate: "1000" }], discountApplicable: false, discountAmount: "500" });

    expect(result.discountAmount).toBe(0);
    expect(result.grandTotal).toBe(1000);
  });

  it("floors the grand total at zero when the discount exceeds the bill", () => {
    const result = totals({ lines: [{ quantity: "1", rate: "500" }], discountApplicable: true, discountAmount: "900" });

    expect(result.grandTotal).toBe(0);
  });

  it("rounds money to 2 decimals so the screen can't drift from the printed invoice", () => {
    const result = totals({ lines: [{ quantity: "3", rate: "33.33" }], gstApplicable: true, gstPercent: "18" });

    expect(result.subtotal).toBe(99.99);
    expect(result.gstAmount).toBe(18);
    expect(result.grandTotal).toBe(117.99);
  });

  it("skips a part row with no item picked yet instead of producing NaN", () => {
    const result = totals({ parts: [{ inventoryItemId: null, quantityUsed: "2" }] });

    expect(result.partsTotal).toBe(0);
    expect(Number.isNaN(result.grandTotal)).toBe(false);
  });

  it("skips a part whose item is no longer in the loaded list", () => {
    const result = totals({ parts: [{ inventoryItemId: "item-deleted", quantityUsed: "1" }] });

    expect(result.partsTotal).toBe(0);
  });

  it("treats unparseable input as zero rather than poisoning the total", () => {
    const result = totals({ lines: [{ quantity: "abc", rate: "xyz" }] });

    expect(result.grandTotal).toBe(0);
  });

  it("returns all zeros for an empty job", () => {
    expect(totals()).toEqual({ subtotal: 0, partsTotal: 0, taxableTotal: 0, gstAmount: 0, discountAmount: 0, grandTotal: 0 });
  });

  it("adds services and parts into one grand total", () => {
    const result = totals({
      lines: [{ quantity: "1", rate: "850" }],
      parts: [
        { inventoryItemId: "item-oil", quantityUsed: "1" },
        { inventoryItemId: "item-filter", quantityUsed: "1" },
      ],
    });

    expect(result.grandTotal).toBe(1550);
  });
});

describe("roundMoney", () => {
  it("rounds half up at the paisa", () => {
    expect(roundMoney(10.005)).toBe(10.01);
  });

  it("clears floating-point noise", () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
  });
});
