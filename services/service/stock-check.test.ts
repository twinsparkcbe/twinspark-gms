import { describe, expect, it } from "vitest";

import { findStockShortfalls, stockShortfallMessage } from "./stock-check";

const items = [
  { id: "oil", productName: "MOTUL - 7100", availableQuantity: 1 },
  { id: "lube", productName: "CHAIN LUBE", availableQuantity: 0 },
  { id: "pad", productName: "BRAKE PAD - FRONT - RC", availableQuantity: 10 },
];

describe("findStockShortfalls", () => {
  it("passes a job whose parts are all in stock", () => {
    expect(
      findStockShortfalls({ parts: [{ inventoryItemId: "pad", quantityUsed: 4 }], items })
    ).toEqual([]);
  });

  it("allows taking the last unit", () => {
    expect(
      findStockShortfalls({ parts: [{ inventoryItemId: "oil", quantityUsed: 1 }], items })
    ).toEqual([]);
  });

  it("reports the part by name, with what is needed and what is there", () => {
    expect(
      findStockShortfalls({ parts: [{ inventoryItemId: "oil", quantityUsed: 3 }], items })
    ).toEqual([{ inventoryItemId: "oil", productName: "MOTUL - 7100", required: 3, available: 1 }]);
  });

  it("sums the same item across two rows — 2 + 2 against a stock of 3 is short", () => {
    const short = findStockShortfalls({
      parts: [
        { inventoryItemId: "pad", quantityUsed: 6 },
        { inventoryItemId: "pad", quantityUsed: 6 },
      ],
      items,
    });
    expect(short).toEqual([
      { inventoryItemId: "pad", productName: "BRAKE PAD - FRONT - RC", required: 12, available: 10 },
    ]);
  });

  it("reports every short part at once, alphabetically", () => {
    const short = findStockShortfalls({
      parts: [
        { inventoryItemId: "oil", quantityUsed: 2 },
        { inventoryItemId: "lube", quantityUsed: 1 },
      ],
      items,
    });
    expect(short.map((s) => s.productName)).toEqual(["CHAIN LUBE", "MOTUL - 7100"]);
  });

  it("ignores rows with no item picked and non-positive quantities", () => {
    expect(
      findStockShortfalls({
        parts: [
          { inventoryItemId: null, quantityUsed: 99 },
          { inventoryItemId: "lube", quantityUsed: 0 },
          { inventoryItemId: "lube", quantityUsed: -5 },
        ],
        items,
      })
    ).toEqual([]);
  });

  it("ignores an item the picker list doesn't know — the form's own error covers that", () => {
    expect(
      findStockShortfalls({ parts: [{ inventoryItemId: "ghost", quantityUsed: 5 }], items })
    ).toEqual([]);
  });

  it("credits back what a completed job already holds, so an untouched correction passes", () => {
    // The job used 5 pads; Inventory now reads 10. Editing it without
    // changing the parts must not be refused.
    expect(
      findStockShortfalls({
        parts: [{ inventoryItemId: "pad", quantityUsed: 5 }],
        items: [{ id: "pad", productName: "BRAKE PAD - FRONT - RC", availableQuantity: 0 }],
        alreadyDeducted: [{ inventoryItemId: "pad", quantityUsed: 5 }],
      })
    ).toEqual([]);
  });

  it("still refuses a correction that asks for more than the credit covers", () => {
    expect(
      findStockShortfalls({
        parts: [{ inventoryItemId: "pad", quantityUsed: 7 }],
        items: [{ id: "pad", productName: "BRAKE PAD - FRONT - RC", availableQuantity: 1 }],
        alreadyDeducted: [{ inventoryItemId: "pad", quantityUsed: 5 }],
      })
    ).toEqual([
      { inventoryItemId: "pad", productName: "BRAKE PAD - FRONT - RC", required: 7, available: 6 },
    ]);
  });

  it("truncates a fractional quantity rather than rejecting on a rounding artefact", () => {
    expect(
      findStockShortfalls({ parts: [{ inventoryItemId: "oil", quantityUsed: 1.9 }], items })
    ).toEqual([]);
  });
});

describe("stockShortfallMessage", () => {
  it("is empty when nothing is short", () => {
    expect(stockShortfallMessage([])).toBe("");
  });

  it("names the part, the numbers, and what to do about it", () => {
    expect(
      stockShortfallMessage([
        { inventoryItemId: "oil", productName: "MOTUL - 7100", required: 3, available: 1 },
      ])
    ).toBe(
      "Not enough stock: MOTUL - 7100 (need 3, have 1). Remove the part from this job, or add stock in Inventory, before billing."
    );
  });

  it("lists several the way the database does, separated by semicolons", () => {
    expect(
      stockShortfallMessage([
        { inventoryItemId: "lube", productName: "CHAIN LUBE", required: 1, available: 0 },
        { inventoryItemId: "oil", productName: "MOTUL - 7100", required: 3, available: 1 },
      ])
    ).toBe(
      "Not enough stock: CHAIN LUBE (need 1, have 0); MOTUL - 7100 (need 3, have 1). Remove those parts from this job, or add stock in Inventory, before billing."
    );
  });
});
