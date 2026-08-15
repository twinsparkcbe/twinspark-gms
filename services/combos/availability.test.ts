import { describe, expect, it } from "vitest";

import { comboUnavailableMessage, comboUnavailableReason, isComboAvailable, istDateString, type ComboAvailability } from "./availability";

function combo(overrides: Partial<ComboAvailability> = {}): ComboAvailability {
  return { isActive: true, validFrom: null, validTo: null, ...overrides };
}

/** 15 Aug 2026, 12:00 IST. */
const MIDDAY_IST = new Date("2026-08-15T06:30:00.000Z");

describe("istDateString", () => {
  it("returns the IST calendar date", () => {
    expect(istDateString(MIDDAY_IST)).toBe("2026-08-15");
  });

  it("still reads as the same IST day late in the evening", () => {
    // 23:30 IST on the 15th is 18:00 UTC — same UTC day here, but the point
    // is the shop's day, not UTC's.
    expect(istDateString(new Date("2026-08-15T18:00:00.000Z"))).toBe("2026-08-15");
  });

  it("rolls to the next IST day after 18:30 UTC", () => {
    // 00:30 IST on the 16th.
    expect(istDateString(new Date("2026-08-15T19:00:00.000Z"))).toBe("2026-08-16");
  });
});

describe("isComboAvailable", () => {
  it("is available when it has no dates at all", () => {
    expect(isComboAvailable(combo(), MIDDAY_IST)).toBe(true);
  });

  it("is unavailable before its start date", () => {
    expect(isComboAvailable(combo({ validFrom: "2026-09-01" }), MIDDAY_IST)).toBe(false);
  });

  it("is available on its start date", () => {
    expect(isComboAvailable(combo({ validFrom: "2026-08-15" }), MIDDAY_IST)).toBe(true);
  });

  it("is available inside its window", () => {
    expect(isComboAvailable(combo({ validFrom: "2026-08-01", validTo: "2026-08-31" }), MIDDAY_IST)).toBe(true);
  });

  it("is available on its last day", () => {
    expect(isComboAvailable(combo({ validTo: "2026-08-15" }), MIDDAY_IST)).toBe(true);
  });

  it("stays available late on its last IST evening — not cut off at UTC midnight", () => {
    // 23:00 IST on the 15th. A UTC-based comparison would already read the
    // 15th as over in some implementations; this must not.
    const lateOnLastDay = new Date("2026-08-15T17:30:00.000Z");
    expect(isComboAvailable(combo({ validTo: "2026-08-15" }), lateOnLastDay)).toBe(true);
  });

  it("is unavailable the day after it ends", () => {
    expect(isComboAvailable(combo({ validTo: "2026-08-14" }), MIDDAY_IST)).toBe(false);
  });

  it("is unavailable when switched off, whatever the dates say", () => {
    expect(isComboAvailable(combo({ isActive: false, validFrom: "2026-08-01", validTo: "2026-08-31" }), MIDDAY_IST)).toBe(false);
  });

  it("is unavailable when switched off even with no dates", () => {
    expect(isComboAvailable(combo({ isActive: false }), MIDDAY_IST)).toBe(false);
  });
});

describe("comboUnavailableReason", () => {
  it("returns null when the combo can be sold", () => {
    expect(comboUnavailableReason(combo(), MIDDAY_IST)).toBeNull();
  });

  it("reports INACTIVE ahead of any date reason", () => {
    expect(comboUnavailableReason(combo({ isActive: false, validTo: "2020-01-01" }), MIDDAY_IST)).toBe("INACTIVE");
  });

  it("reports NOT_STARTED before the window", () => {
    expect(comboUnavailableReason(combo({ validFrom: "2026-09-01" }), MIDDAY_IST)).toBe("NOT_STARTED");
  });

  it("reports EXPIRED after the window", () => {
    expect(comboUnavailableReason(combo({ validTo: "2026-08-01" }), MIDDAY_IST)).toBe("EXPIRED");
  });
});

describe("comboUnavailableMessage", () => {
  it("names the combo in each message", () => {
    expect(comboUnavailableMessage("INACTIVE", "Monsoon Combo")).toContain("Monsoon Combo");
    expect(comboUnavailableMessage("NOT_STARTED", "Monsoon Combo")).toContain("hasn't started");
    expect(comboUnavailableMessage("EXPIRED", "Monsoon Combo")).toContain("has ended");
  });
});
