import { describe, expect, it } from "vitest";

import { computeDelta, computeMarginPercent, formatDeltaPercent, formatMarginPercent } from "./delta";

describe("computeDelta", () => {
  it("returns a rounded signed percentage off a positive base", () => {
    expect(computeDelta(5400, 4580)).toEqual({ kind: "percent", value: 18, direction: "up" });
  });

  it("reports a decrease as a negative percentage", () => {
    expect(computeDelta(4000, 5000)).toEqual({ kind: "percent", value: -20, direction: "down" });
  });

  it("reports an unchanged figure as flat, not as nothing", () => {
    expect(computeDelta(5000, 5000)).toEqual({ kind: "percent", value: 0, direction: "flat" });
  });

  it("shows nothing at all when both periods are zero", () => {
    // A brand-new garage with no history — "0%" would imply a comparison
    // actually happened.
    expect(computeDelta(0, 0)).toEqual({ kind: "none" });
  });

  it('reports first-ever activity as "new" rather than an infinite percentage', () => {
    expect(computeDelta(5400, 0)).toEqual({ kind: "new" });
  });

  it("reports a drop to zero as −100%", () => {
    expect(computeDelta(0, 5000)).toEqual({ kind: "percent", value: -100, direction: "down" });
  });

  it("falls back to an absolute change when the base is negative", () => {
    // −500 → +700 is a ₹1,200 swing. Expressing that as "+240%" off a
    // negative base is meaningless to read.
    expect(computeDelta(700, -500)).toEqual({ kind: "absolute", value: 1200, direction: "up" });
  });

  it("falls back to an absolute change when a first-ever period is a loss", () => {
    expect(computeDelta(-4000, 0)).toEqual({ kind: "absolute", value: -4000, direction: "down" });
  });

  it("rounds percentages to a whole number rather than leaking float artifacts", () => {
    const delta = computeDelta(1000, 3000);
    expect(delta).toEqual({ kind: "percent", value: -67, direction: "down" });
  });
});

describe("formatDeltaPercent", () => {
  it("prefixes an increase with a plus sign", () => {
    expect(formatDeltaPercent(18)).toBe("+18%");
  });

  it("renders a decrease with a true minus sign, not a hyphen", () => {
    expect(formatDeltaPercent(-20)).toBe("−20%");
  });

  it("renders no sign for an unchanged figure", () => {
    expect(formatDeltaPercent(0)).toBe("0%");
  });
});

describe("computeMarginPercent", () => {
  it("returns profit as a share of sales, to one decimal", () => {
    expect(computeMarginPercent(1500, 5400)).toBe(27.8);
  });

  it("returns null when nothing was sold, rather than dividing by zero", () => {
    expect(computeMarginPercent(0, 0)).toBeNull();
  });

  it("returns null even when a profit figure exists but sales are zero", () => {
    expect(computeMarginPercent(-200, 0)).toBeNull();
  });

  it("returns a negative margin as-is when cost of goods sold exceeded sales", () => {
    expect(computeMarginPercent(-4000, 10000)).toBe(-40);
  });
});

describe("formatMarginPercent", () => {
  it('renders an em dash when there is no margin to show', () => {
    expect(formatMarginPercent(null)).toBe("—");
  });

  it("always shows one decimal place so the figure doesn't jitter in width", () => {
    expect(formatMarginPercent(30)).toBe("30.0% margin");
  });
});
