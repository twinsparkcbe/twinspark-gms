import { describe, expect, it } from "vitest";

import {
  buildTrackTyreProductName,
  formatStockRatio,
  getItemTypeBadgeText,
  getTrackTyrePosition,
  ITEM_TYPE_LABELS,
  stockRowTone,
} from "./constants";

describe("stockRowTone", () => {
  it("tints an out-of-stock row as danger", () => {
    expect(stockRowTone({ stockStatus: "out_of_stock" })).toBe("danger");
  });

  it("tints a low-stock row as warning", () => {
    expect(stockRowTone({ stockStatus: "low_stock" })).toBe("warning");
  });

  it("leaves a healthy row untinted, so the tinted ones stand out", () => {
    expect(stockRowTone({ stockStatus: "in_stock" })).toBeNull();
  });
});

describe("formatStockRatio", () => {
  it("spells out quantity against threshold so the state survives without colour", () => {
    expect(formatStockRatio({ availableQuantity: 0, lowStockThreshold: 5 })).toBe("0 / 5");
  });

  it("does not clamp stock that sits well above the threshold", () => {
    expect(formatStockRatio({ availableQuantity: 114, lowStockThreshold: 20 })).toBe("114 / 20");
  });

  it("groups large quantities in the Indian numbering system", () => {
    expect(formatStockRatio({ availableQuantity: 12500, lowStockThreshold: 100 })).toBe("12,500 / 100");
  });
});

describe("getItemTypeBadgeText", () => {
  it("returns the static label for every type except Other Spare Part", () => {
    expect(getItemTypeBadgeText({ itemType: "TRACK_TYRE", customTypeLabel: null })).toBe(
      ITEM_TYPE_LABELS.TRACK_TYRE
    );
    expect(getItemTypeBadgeText({ itemType: "ENGINE_OIL", customTypeLabel: null })).toBe(
      ITEM_TYPE_LABELS.ENGINE_OIL
    );
  });

  it("returns the item's customTypeLabel for Other Spare Part", () => {
    expect(
      getItemTypeBadgeText({ itemType: "OTHER_SPARE_PART", customTypeLabel: "Helmet Lock" })
    ).toBe("Helmet Lock");
  });

  it("falls back to the static Other Spare Part label if customTypeLabel is null", () => {
    expect(getItemTypeBadgeText({ itemType: "OTHER_SPARE_PART", customTypeLabel: null })).toBe(
      ITEM_TYPE_LABELS.OTHER_SPARE_PART
    );
  });
});

describe("buildTrackTyreProductName", () => {
  it("derives the product name from the position", () => {
    expect(buildTrackTyreProductName("Front")).toBe("Track Tyre - Front");
    expect(buildTrackTyreProductName("Back")).toBe("Track Tyre - Back");
  });
});

describe("getTrackTyrePosition", () => {
  it("parses a derived product name back into its position", () => {
    expect(getTrackTyrePosition("Track Tyre - Front")).toBe("Front");
    expect(getTrackTyrePosition("Track Tyre - Back")).toBe("Back");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(getTrackTyrePosition("  track tyre - front  ")).toBe("Front");
  });

  // Legacy pre-split singleton — must not silently guess a position.
  it("returns null for the old singleton name 'Track Tyre'", () => {
    expect(getTrackTyrePosition("Track Tyre")).toBeNull();
  });

  it("returns null for an unrelated product name", () => {
    expect(getTrackTyrePosition("Michelin Pilot Street 2 140/70 R17")).toBeNull();
  });
});
