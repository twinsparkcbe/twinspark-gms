import { describe, expect, it } from "vitest";

import { computeComboPricing, type ComboPricingComponent } from "./pricing";

function item(overrides: Partial<ComboPricingComponent> = {}): ComboPricingComponent {
  return { componentType: "ITEM", quantity: 1, pricing: "INCLUDED", unitPrice: 450, unitPurchasePrice: 300, ...overrides };
}

function pkg(overrides: Partial<ComboPricingComponent> = {}): ComboPricingComponent {
  return { componentType: "PACKAGE", quantity: 1, pricing: "INCLUDED", unitPrice: 850, ...overrides };
}

function specific(overrides: Partial<ComboPricingComponent> = {}): ComboPricingComponent {
  return { componentType: "SPECIFIC", quantity: 1, pricing: "INCLUDED", unitPrice: 200, ...overrides };
}

describe("computeComboPricing — list value", () => {
  it("sums every included component at its catalog price", () => {
    const result = computeComboPricing([pkg(), specific(), item()], 1200);

    expect(result.listValue).toBe(1500); // 850 + 200 + 450
  });

  it("multiplies by component quantity", () => {
    expect(computeComboPricing([item({ quantity: 2 })], 800).listValue).toBe(900);
  });

  it("treats a specific service with no suggested charge as zero, not NaN", () => {
    const result = computeComboPricing([specific({ unitPrice: null })], 100);

    expect(result.listValue).toBe(0);
    expect(Number.isNaN(result.savings)).toBe(false);
  });

  it("excludes EXTRA components — they bill on top, so they're outside the comparison", () => {
    const result = computeComboPricing([item({ pricing: "INCLUDED" }), item({ pricing: "EXTRA", unitPrice: 9999 })], 400);

    expect(result.listValue).toBe(450);
  });

  it("returns zero for a combo with no included components", () => {
    expect(computeComboPricing([item({ pricing: "EXTRA" })], 500).listValue).toBe(0);
  });
});

describe("computeComboPricing — savings", () => {
  it("is list value minus combo price", () => {
    const result = computeComboPricing([pkg({ unitPrice: 9240 })], 7499);

    expect(result.savings).toBe(1741);
  });

  it("reports the saving as a percentage of list value", () => {
    expect(computeComboPricing([pkg({ unitPrice: 1000 })], 750).savingsPercent).toBe(25);
  });

  it("is zero when the combo is priced at list", () => {
    const result = computeComboPricing([pkg({ unitPrice: 1000 })], 1000);

    expect(result.savings).toBe(0);
    expect(result.isPricedAboveList).toBe(false);
  });

  it("never reports a negative saving — it flags the combo instead", () => {
    const result = computeComboPricing([pkg({ unitPrice: 500 })], 900);

    expect(result.savings).toBe(0);
    expect(result.isPricedAboveList).toBe(true);
  });

  it("reports zero percent when there is nothing to compare against", () => {
    expect(computeComboPricing([], 500).savingsPercent).toBe(0);
  });
});

describe("computeComboPricing — cost and margin", () => {
  it("costs the goods at purchase price, never selling price", () => {
    const result = computeComboPricing([item({ unitPrice: 450, unitPurchasePrice: 300 })], 400);

    expect(result.cost).toBe(300);
  });

  it("multiplies cost by quantity", () => {
    expect(computeComboPricing([item({ quantity: 2, unitPurchasePrice: 300 })], 1000).cost).toBe(600);
  });

  it("counts only inventory items — a service has no cost of goods", () => {
    expect(computeComboPricing([pkg(), specific(), item({ unitPurchasePrice: 300 })], 1000).cost).toBe(300);
  });

  it("ignores EXTRA items in cost, since they aren't given away by the combo price", () => {
    expect(computeComboPricing([item({ pricing: "EXTRA", unitPurchasePrice: 300 })], 1000).cost).toBe(0);
  });

  it("treats a missing purchase price as zero rather than NaN", () => {
    const result = computeComboPricing([item({ unitPurchasePrice: null })], 500);

    expect(result.cost).toBe(0);
    expect(Number.isNaN(result.margin)).toBe(false);
  });

  it("margin is combo price minus cost", () => {
    expect(computeComboPricing([item({ unitPurchasePrice: 300 })], 1000).margin).toBe(700);
  });

  it("flags a combo priced below the cost of its own goods", () => {
    const result = computeComboPricing([item({ unitPurchasePrice: 300, quantity: 4 })], 1000);

    expect(result.cost).toBe(1200);
    expect(result.margin).toBe(-200);
    expect(result.isBelowCost).toBe(true);
  });

  it("does not flag a combo priced exactly at cost", () => {
    expect(computeComboPricing([item({ unitPurchasePrice: 300 })], 300).isBelowCost).toBe(false);
  });
});

describe("computeComboPricing — rounding", () => {
  it("rounds every money figure to 2 decimals", () => {
    const result = computeComboPricing([item({ unitPrice: 33.333, unitPurchasePrice: 11.111, quantity: 3 })], 99.999);

    expect(result.listValue).toBe(100);
    expect(result.cost).toBe(33.33);
    expect(result.comboPrice).toBe(100);
  });

  it("clears floating-point noise in the saving", () => {
    const result = computeComboPricing([item({ unitPrice: 0.3 }), item({ unitPrice: 0.6, pricing: "INCLUDED" })], 0);

    expect(result.listValue).toBe(0.9);
  });
});

describe("computeComboPricing — the poster combo", () => {
  it("prices the ₹7,499 bundle end to end", () => {
    const components: ComboPricingComponent[] = [
      { componentType: "ITEM", quantity: 2, pricing: "INCLUDED", unitPrice: 3200, unitPurchasePrice: 1900 }, // tyres
      { componentType: "PACKAGE", quantity: 1, pricing: "INCLUDED", unitPrice: 850 }, // general service
      { componentType: "ITEM", quantity: 1, pricing: "INCLUDED", unitPrice: 450, unitPurchasePrice: 300 }, // engine oil
      { componentType: "ITEM", quantity: 1, pricing: "INCLUDED", unitPrice: 250, unitPurchasePrice: 160 }, // oil filter
      { componentType: "SPECIFIC", quantity: 1, pricing: "INCLUDED", unitPrice: 150 }, // water wash
      { componentType: "SPECIFIC", quantity: 1, pricing: "INCLUDED", unitPrice: 200 }, // foam wash
      { componentType: "SPECIFIC", quantity: 1, pricing: "INCLUDED", unitPrice: 200 }, // chain clean
    ];

    const result = computeComboPricing(components, 7499);

    expect(result.listValue).toBe(8500);
    expect(result.savings).toBe(1001);
    expect(result.cost).toBe(4260); // 3800 tyres + 300 oil + 160 filter
    expect(result.margin).toBe(3239);
    expect(result.isBelowCost).toBe(false);
    expect(result.isPricedAboveList).toBe(false);
  });
});
