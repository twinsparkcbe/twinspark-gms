import { describe, expect, it } from "vitest";

import { mergeDefaultItemsIntoParts, type MergeablePart } from "./parts-merge";

let counter = 0;
const newId = () => `generated-${++counter}`;

function resetIds() {
  counter = 0;
}

describe("mergeDefaultItemsIntoParts", () => {
  it("adds a row for an item not already on the list", () => {
    resetIds();
    const result = mergeDefaultItemsIntoParts([], [{ inventoryItemId: "item-oil", itemName: "Engine Oil 1L", defaultQuantity: 1 }], newId);

    expect(result).toEqual([{ id: "generated-1", inventoryItemId: "item-oil", quantityUsed: "1" }]);
  });

  it("stacks quantity onto an existing row instead of duplicating it", () => {
    const existing: MergeablePart[] = [{ id: "row-1", inventoryItemId: "item-oil", quantityUsed: "1" }];
    const result = mergeDefaultItemsIntoParts(existing, [{ inventoryItemId: "item-oil", itemName: "Engine Oil 1L", defaultQuantity: 2 }], newId);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "row-1", quantityUsed: "3" });
  });

  it("stacks again when the same package is picked twice — one-way by design", () => {
    const once = mergeDefaultItemsIntoParts([], [{ inventoryItemId: "item-oil", itemName: "Engine Oil 1L", defaultQuantity: 1 }], newId);
    const twice = mergeDefaultItemsIntoParts(once, [{ inventoryItemId: "item-oil", itemName: "Engine Oil 1L", defaultQuantity: 1 }], newId);

    expect(twice).toHaveLength(1);
    expect(twice[0].quantityUsed).toBe("2");
  });

  it("adds several default items in one pass", () => {
    resetIds();
    const result = mergeDefaultItemsIntoParts(
      [],
      [
        { inventoryItemId: "item-oil", itemName: "Engine Oil 1L", defaultQuantity: 1 },
        { inventoryItemId: "item-filter", itemName: "Oil Filter", defaultQuantity: 1 },
      ],
      newId
    );

    expect(result.map((p) => p.inventoryItemId)).toEqual(["item-oil", "item-filter"]);
  });

  it("returns the list untouched when the catalog entry has no default items", () => {
    const existing: MergeablePart[] = [{ id: "row-1", inventoryItemId: "item-oil", quantityUsed: "1" }];

    expect(mergeDefaultItemsIntoParts(existing, [], newId)).toBe(existing);
  });

  it("preserves manually-edited quantities on unrelated rows", () => {
    const existing: MergeablePart[] = [
      { id: "row-1", inventoryItemId: "item-brake-pad", quantityUsed: "4" },
      { id: "row-2", inventoryItemId: "item-oil", quantityUsed: "1" },
    ];
    const result = mergeDefaultItemsIntoParts(existing, [{ inventoryItemId: "item-filter", itemName: "Oil Filter", defaultQuantity: 1 }], newId);

    expect(result[0]).toEqual({ id: "row-1", inventoryItemId: "item-brake-pad", quantityUsed: "4" });
    expect(result[1]).toEqual({ id: "row-2", inventoryItemId: "item-oil", quantityUsed: "1" });
  });

  it("never mutates the array it was given", () => {
    const existing: MergeablePart[] = [{ id: "row-1", inventoryItemId: "item-oil", quantityUsed: "1" }];
    const snapshot = structuredClone(existing);

    mergeDefaultItemsIntoParts(existing, [{ inventoryItemId: "item-oil", itemName: "Engine Oil 1L", defaultQuantity: 5 }], newId);

    expect(existing).toEqual(snapshot);
  });

  it("treats a blank existing quantity as zero when stacking", () => {
    const existing: MergeablePart[] = [{ id: "row-1", inventoryItemId: "item-oil", quantityUsed: "" }];
    const result = mergeDefaultItemsIntoParts(existing, [{ inventoryItemId: "item-oil", itemName: "Engine Oil 1L", defaultQuantity: 2 }], newId);

    expect(result[0].quantityUsed).toBe("2");
  });

  it("does not match an empty row (no item picked) when merging", () => {
    resetIds();
    const existing: MergeablePart[] = [{ id: "row-1", inventoryItemId: null, quantityUsed: "1" }];
    const result = mergeDefaultItemsIntoParts(existing, [{ inventoryItemId: "item-oil", itemName: "Engine Oil 1L", defaultQuantity: 1 }], newId);

    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ inventoryItemId: "item-oil", quantityUsed: "1" });
  });
});
