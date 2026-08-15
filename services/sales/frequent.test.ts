import { describe, expect, it } from "vitest";

import { salePickerKey } from "./picker";
import { tallySaleUsage } from "./frequent";

const TYRE = "33333333-3333-4333-8333-333333333301";
const OIL = "33333333-3333-4333-8333-333333333302";
const COMBO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function product(id: string, includedInCombo = false) {
  return { line_type: "PRODUCT" as const, inventory_item_id: id, combo_id: null, included_in_combo: includedInCombo };
}

describe("tallySaleUsage", () => {
  it("counts how often an item appears on a sale", () => {
    expect(tallySaleUsage([product(TYRE), product(TYRE), product(OIL)])).toEqual({
      [salePickerKey("ITEM", TYRE)]: 2,
      [salePickerKey("ITEM", OIL)]: 1,
    });
  });

  it("counts rows, not units — a chip should surface what sells often, not what moves in bulk", () => {
    // Two separate one-unit sales beat a single ten-unit invoice.
    expect(tallySaleUsage([product(TYRE), product(TYRE)])[salePickerKey("ITEM", TYRE)]).toBe(2);
  });

  // Combos are deliberately not offered in Sale Items (confirmed decision,
  // 2026-08-15) — a COMBO row is simply never tallied, not tallied against
  // a key nothing will ever match.
  it("ignores a combo line entirely", () => {
    const rows = [{ line_type: "COMBO" as const, inventory_item_id: null, combo_id: COMBO, included_in_combo: false }];

    expect(tallySaleUsage(rows)).toEqual({});
  });

  it("skips products the server expanded out of a combo", () => {
    // A tyre that only ever moves inside a bundle shouldn't earn its own chip.
    expect(tallySaleUsage([product(TYRE, true)])).toEqual({});
  });

  it("still counts a loose sale of an item that also appears in combos", () => {
    expect(tallySaleUsage([product(TYRE, true), product(TYRE)])).toEqual({ [salePickerKey("ITEM", TYRE)]: 1 });
  });

  it("ignores installation lines entirely", () => {
    const rows = [{ line_type: "INSTALLATION" as const, inventory_item_id: null, combo_id: null, included_in_combo: false }];

    expect(tallySaleUsage(rows)).toEqual({});
  });

  it("returns an empty tally for no history", () => {
    expect(tallySaleUsage([])).toEqual({});
  });
});
