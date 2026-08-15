import { describe, expect, it } from "vitest";

import { countLooseTyres, createTyreLookup, getFittingNudge, hasComboCoveringFitting, hasFittingLine, type FittingCheckLine } from "./fitting";

const FRONT_TYRE = "tyre-front";
const REAR_TYRE = "tyre-rear";
const OIL = "engine-oil";

const lookup = createTyreLookup([
  { id: FRONT_TYRE, itemType: "BRAND_NEW_TYRE" },
  { id: REAR_TYRE, itemType: "TRACK_TYRE" },
  { id: OIL, itemType: "ENGINE_OIL" },
]);

function tyre(quantity = 1, overrides: Partial<FittingCheckLine> = {}): FittingCheckLine {
  return { lineType: "PRODUCT", inventoryItemId: FRONT_TYRE, quantity, ...overrides };
}

function fitting(): FittingCheckLine {
  return { lineType: "INSTALLATION", installationSubtype: "TYRE_FITTING" };
}

describe("createTyreLookup", () => {
  it("treats both Brand New and Track tyres as tyres", () => {
    expect(lookup.isTyre(FRONT_TYRE)).toBe(true);
    expect(lookup.isTyre(REAR_TYRE)).toBe(true);
  });

  it("treats other stock as not a tyre", () => {
    expect(lookup.isTyre(OIL)).toBe(false);
  });

  it("returns false for an unknown id rather than throwing", () => {
    expect(lookup.isTyre("nope")).toBe(false);
  });
});

describe("countLooseTyres", () => {
  it("counts tyre quantity across product lines", () => {
    expect(countLooseTyres([tyre(1), tyre(1, { inventoryItemId: REAR_TYRE })], lookup)).toBe(2);
  });

  it("respects a quantity above one", () => {
    expect(countLooseTyres([tyre(4)], lookup)).toBe(4);
  });

  it("ignores non-tyre products", () => {
    expect(countLooseTyres([{ lineType: "PRODUCT", inventoryItemId: OIL, quantity: 3 }], lookup)).toBe(0);
  });

  it("excludes tyres that came in with a combo — their fitting is already paid for", () => {
    expect(countLooseTyres([tyre(2, { includedInCombo: true })], lookup)).toBe(0);
  });

  it("counts loose tyres alongside combo tyres on the same sale", () => {
    expect(countLooseTyres([tyre(2, { includedInCombo: true }), tyre(1)], lookup)).toBe(1);
  });

  it("returns zero for an empty sale", () => {
    expect(countLooseTyres([], lookup)).toBe(0);
  });
});

describe("hasFittingLine / hasComboCoveringFitting", () => {
  it("spots a tyre-fitting line", () => {
    expect(hasFittingLine([tyre(2), fitting()])).toBe(true);
  });

  it("doesn't mistake a custom installation charge for fitting", () => {
    expect(hasFittingLine([{ lineType: "INSTALLATION", installationSubtype: "CUSTOM" }])).toBe(false);
  });

  it("spots a combo that covers fitting", () => {
    expect(hasComboCoveringFitting([{ lineType: "COMBO", comboCoversFitting: true }])).toBe(true);
  });

  it("ignores a combo with no tyres in it", () => {
    expect(hasComboCoveringFitting([{ lineType: "COMBO", comboCoversFitting: false }])).toBe(false);
  });
});

describe("getFittingNudge — suggesting the missing charge", () => {
  it("suggests fitting when tyres are on the sale and nothing covers it", () => {
    expect(getFittingNudge([tyre(2)], lookup)).toEqual({ kind: "SUGGEST_FITTING", wheelCount: 2, amount: 600 });
  });

  it("prices the suggestion at ₹300 a wheel", () => {
    expect(getFittingNudge([tyre(4)], lookup)).toMatchObject({ amount: 1200 });
  });

  it("says nothing once a fitting line has been added", () => {
    expect(getFittingNudge([tyre(2), fitting()], lookup)).toBeNull();
  });

  it("says nothing when the sale has no tyres", () => {
    expect(getFittingNudge([{ lineType: "PRODUCT", inventoryItemId: OIL, quantity: 1 }], lookup)).toBeNull();
  });

  it("says nothing on an empty sale", () => {
    expect(getFittingNudge([], lookup)).toBeNull();
  });

  it("stays quiet once dismissed for this sale", () => {
    expect(getFittingNudge([tyre(2)], lookup, { dismissed: true })).toBeNull();
  });

  it("counts only the tyres actually being paid for", () => {
    expect(getFittingNudge([tyre(2, { includedInCombo: true }), tyre(1)], lookup)).toMatchObject({ wheelCount: 1, amount: 300 });
  });
});

describe("getFittingNudge — the double-charge guard", () => {
  it("warns when a combo already covers fitting and a fitting line was added anyway", () => {
    const lines: FittingCheckLine[] = [{ lineType: "COMBO", comboCoversFitting: true }, fitting()];

    expect(getFittingNudge(lines, lookup)).toEqual({ kind: "ALREADY_IN_COMBO" });
  });

  it("warns even when the suggestion was dismissed — being billed twice isn't a preference", () => {
    const lines: FittingCheckLine[] = [{ lineType: "COMBO", comboCoversFitting: true }, fitting()];

    expect(getFittingNudge(lines, lookup, { dismissed: true })).toEqual({ kind: "ALREADY_IN_COMBO" });
  });

  it("stays silent for a fitting-covering combo with no separate fitting line", () => {
    expect(getFittingNudge([{ lineType: "COMBO", comboCoversFitting: true }], lookup)).toBeNull();
  });

  it("doesn't suggest fitting for loose tyres while a fitting-covering combo is present", () => {
    // Ambiguous on purpose: the admin can still add fitting by hand, but
    // auto-suggesting risks the double-charge this guard exists to prevent.
    const lines: FittingCheckLine[] = [{ lineType: "COMBO", comboCoversFitting: true }, tyre(2)];

    expect(getFittingNudge(lines, lookup)).toBeNull();
  });

  it("suggests normally for a combo that contains no tyres", () => {
    const lines: FittingCheckLine[] = [{ lineType: "COMBO", comboCoversFitting: false }, tyre(2)];

    expect(getFittingNudge(lines, lookup)).toMatchObject({ kind: "SUGGEST_FITTING", wheelCount: 2 });
  });
});
