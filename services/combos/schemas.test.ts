import { describe, expect, it } from "vitest";

import { comboComponentInputSchema, comboInputSchema, mergeDuplicateComponents, type ComboComponentInput } from "./schemas";

const PKG = "11111111-1111-4111-8111-111111111101";
const SVC = "22222222-2222-4222-8222-222222222201";
const ITEM = "33333333-3333-4333-8333-333333333301";
const ITEM_2 = "33333333-3333-4333-8333-333333333302";

function itemComponent(overrides: Partial<ComboComponentInput> = {}) {
  return { componentType: "ITEM" as const, inventoryItemId: ITEM, quantity: 1, pricing: "INCLUDED" as const, ...overrides };
}

function combo(overrides: Record<string, unknown> = {}) {
  return { name: "₹7,499 Combo", comboPrice: 7499, components: [itemComponent()], ...overrides };
}

describe("comboComponentInputSchema", () => {
  it("accepts an ITEM component with an inventory item", () => {
    expect(comboComponentInputSchema.safeParse(itemComponent()).success).toBe(true);
  });

  it("accepts a PACKAGE component", () => {
    expect(comboComponentInputSchema.safeParse({ componentType: "PACKAGE", generalServicePackageId: PKG }).success).toBe(true);
  });

  it("accepts a SPECIFIC component", () => {
    expect(comboComponentInputSchema.safeParse({ componentType: "SPECIFIC", specificServiceId: SVC }).success).toBe(true);
  });

  it("rejects a component that references nothing", () => {
    expect(comboComponentInputSchema.safeParse({ componentType: "ITEM" }).success).toBe(false);
  });

  it("rejects a component that references two things at once", () => {
    const result = comboComponentInputSchema.safeParse({ componentType: "ITEM", inventoryItemId: ITEM, specificServiceId: SVC });
    expect(result.success).toBe(false);
  });

  it("defaults quantity to 1 and pricing to INCLUDED", () => {
    const result = comboComponentInputSchema.parse({ componentType: "ITEM", inventoryItemId: ITEM });
    expect(result.quantity).toBe(1);
    expect(result.pricing).toBe("INCLUDED");
  });

  it("rejects a zero or negative quantity", () => {
    expect(comboComponentInputSchema.safeParse(itemComponent({ quantity: 0 })).success).toBe(false);
    expect(comboComponentInputSchema.safeParse(itemComponent({ quantity: -2 })).success).toBe(false);
  });

  it("rejects a fractional quantity", () => {
    expect(comboComponentInputSchema.safeParse(itemComponent({ quantity: 1.5 })).success).toBe(false);
  });

  it("rejects an unknown pricing value", () => {
    expect(comboComponentInputSchema.safeParse({ ...itemComponent(), pricing: "FREE" }).success).toBe(false);
  });
});

describe("comboInputSchema", () => {
  it("accepts a minimal valid combo", () => {
    expect(comboInputSchema.safeParse(combo()).success).toBe(true);
  });

  it("requires a name", () => {
    expect(comboInputSchema.safeParse(combo({ name: "   " })).success).toBe(false);
  });

  it("trims the name", () => {
    expect(comboInputSchema.parse(combo({ name: "  Monsoon Combo  " })).name).toBe("Monsoon Combo");
  });

  it("rejects a negative combo price", () => {
    expect(comboInputSchema.safeParse(combo({ comboPrice: -1 })).success).toBe(false);
  });

  it("accepts a zero price — a genuinely free promotional bundle", () => {
    expect(comboInputSchema.safeParse(combo({ comboPrice: 0 })).success).toBe(true);
  });

  it("rejects a combo with no components", () => {
    expect(comboInputSchema.safeParse(combo({ components: [] })).success).toBe(false);
  });

  it("treats both offer dates as optional", () => {
    const result = comboInputSchema.parse(combo());
    expect(result.validFrom).toBeUndefined();
    expect(result.validTo).toBeUndefined();
  });

  it("accepts a start date alone (offer with no end)", () => {
    expect(comboInputSchema.safeParse(combo({ validFrom: "2026-08-01" })).success).toBe(true);
  });

  it("accepts an end date alone", () => {
    expect(comboInputSchema.safeParse(combo({ validTo: "2026-08-31" })).success).toBe(true);
  });

  it("accepts a well-ordered window", () => {
    expect(comboInputSchema.safeParse(combo({ validFrom: "2026-08-01", validTo: "2026-08-31" })).success).toBe(true);
  });

  it("accepts a single-day offer", () => {
    expect(comboInputSchema.safeParse(combo({ validFrom: "2026-08-15", validTo: "2026-08-15" })).success).toBe(true);
  });

  it("rejects an end date before the start date", () => {
    const result = comboInputSchema.safeParse(combo({ validFrom: "2026-08-31", validTo: "2026-08-01" }));
    expect(result.success).toBe(false);
  });

  it("rejects a malformed date", () => {
    expect(comboInputSchema.safeParse(combo({ validFrom: "31-08-2026" })).success).toBe(false);
  });

  it("treats an empty date string as no date at all", () => {
    expect(comboInputSchema.parse(combo({ validFrom: "" })).validFrom).toBeUndefined();
  });
});

describe("mergeDuplicateComponents", () => {
  it("folds a repeated product into one component with summed quantity", () => {
    const merged = mergeDuplicateComponents([itemComponent({ quantity: 1 }), itemComponent({ quantity: 2 })]);

    expect(merged).toHaveLength(1);
    expect(merged[0].quantity).toBe(3);
  });

  it("keeps different products apart", () => {
    const merged = mergeDuplicateComponents([itemComponent(), itemComponent({ inventoryItemId: ITEM_2 })]);

    expect(merged).toHaveLength(2);
  });

  it("keeps a package and an item apart even in the same combo", () => {
    const merged = mergeDuplicateComponents([itemComponent(), { componentType: "PACKAGE", generalServicePackageId: PKG, quantity: 1, pricing: "INCLUDED" }]);

    expect(merged).toHaveLength(2);
  });

  it("an EXTRA duplicate wins, so a billable component never silently becomes free", () => {
    const merged = mergeDuplicateComponents([itemComponent({ pricing: "INCLUDED" }), itemComponent({ pricing: "EXTRA" })]);

    expect(merged[0].pricing).toBe("EXTRA");
  });

  it("never mutates the input array", () => {
    const input = [itemComponent({ quantity: 1 }), itemComponent({ quantity: 2 })];
    const snapshot = structuredClone(input);

    mergeDuplicateComponents(input);

    expect(input).toEqual(snapshot);
  });

  it("returns an empty list unchanged", () => {
    expect(mergeDuplicateComponents([])).toEqual([]);
  });
});
