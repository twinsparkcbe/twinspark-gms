import { describe, expect, it } from "vitest";

import { resolveDateRangePreset } from "./date-range";
import { resolvePreviousPeriod } from "./previous-period";

// IST is UTC+5:30 — 2026-08-12T04:30:00Z is 12 Aug 10:00 IST, comfortably
// mid-day so the wall-clock date is unambiguous either side of the offset.
const NOW = new Date("2026-08-12T04:30:00.000Z");

/** IST wall-clock rendering, so assertions read the way the owner sees dates. */
function ist(date: Date): string {
  return new Date(date.getTime() + 5.5 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19);
}

function previousFor(preset: Parameters<typeof resolvePreviousPeriod>[0], now: Date = NOW) {
  return resolvePreviousPeriod(preset, resolveDateRangePreset(preset, now));
}

describe("resolvePreviousPeriod — duration matching", () => {
  it("compares an in-progress month against the same number of elapsed days, not the whole prior month", () => {
    const previous = previousFor("this_month");
    expect(ist(previous.from)).toBe("2026-07-01 00:00:00");
    expect(ist(previous.to)).toBe("2026-07-12 10:00:00");
  });

  it("compares today against the same elapsed slice of yesterday", () => {
    const previous = previousFor("today");
    expect(ist(previous.from)).toBe("2026-08-11 00:00:00");
    expect(ist(previous.to)).toBe("2026-08-11 10:00:00");
  });

  it("compares this week against the same weekday and time of the previous week", () => {
    // 12 Aug 2026 is a Wednesday, so the range starts Monday 10 Aug.
    const previous = previousFor("this_week");
    expect(ist(previous.from)).toBe("2026-08-03 00:00:00");
    expect(ist(previous.to)).toBe("2026-08-05 10:00:00");
  });

  it("compares this quarter against the same offset into the previous quarter", () => {
    // Q3 starts 1 Jul; 12 Aug is 42 days + 10h in.
    const previous = previousFor("this_quarter");
    expect(ist(previous.from)).toBe("2026-04-01 00:00:00");
    expect(ist(previous.to)).toBe("2026-05-13 10:00:00");
  });

  it("compares this year against the same offset into the previous year", () => {
    const previous = previousFor("this_year");
    expect(ist(previous.from)).toBe("2025-01-01 00:00:00");
    expect(ist(previous.to)).toBe("2025-08-12 10:00:00");
  });

  it("never lets the comparison window overlap the selected range", () => {
    for (const preset of ["today", "this_week", "this_month", "last_month", "this_quarter", "this_year"] as const) {
      const current = resolveDateRangePreset(preset, NOW);
      const previous = resolvePreviousPeriod(preset, current);
      expect(previous.to.getTime()).toBeLessThan(current.from.getTime());
      expect(previous.from.getTime()).toBeLessThanOrEqual(previous.to.getTime());
    }
  });
});

describe("resolvePreviousPeriod — calendar overflow", () => {
  it("clamps to the end of the shorter prior month instead of bleeding into the current one", () => {
    // 31 March: 30 days + 10h elapsed. 1 Feb + that duration would land in
    // March, so it must be pulled back to the last instant of February.
    const march31 = new Date("2026-03-31T04:30:00.000Z");
    const previous = previousFor("this_month", march31);
    expect(ist(previous.from)).toBe("2026-02-01 00:00:00");
    expect(ist(previous.to)).toBe("2026-02-28 23:59:59");
  });

  it("steps back across a year boundary for January", () => {
    const jan10 = new Date("2026-01-10T04:30:00.000Z");
    const previous = previousFor("this_month", jan10);
    expect(ist(previous.from)).toBe("2025-12-01 00:00:00");
    expect(ist(previous.to)).toBe("2025-12-10 10:00:00");
  });

  it("steps back across a year boundary for Q1", () => {
    const feb10 = new Date("2026-02-10T04:30:00.000Z");
    const previous = previousFor("this_quarter", feb10);
    expect(ist(previous.from)).toBe("2025-10-01 00:00:00");
  });
});

describe("resolvePreviousPeriod — completed and custom ranges", () => {
  it("compares Last Month against the whole preceding calendar month, not a duration-matched slice", () => {
    // Selected range is all of July (31 days); June only has 30. The
    // comparison must still be the whole of June, not 31 days ending in July.
    const previous = previousFor("last_month");
    expect(ist(previous.from)).toBe("2026-06-01 00:00:00");
    expect(ist(previous.to)).toBe("2026-06-30 23:59:59");
  });

  it("compares a custom range against the identically-sized window immediately before it", () => {
    const current = resolveDateRangePreset("custom", NOW, { fromYMD: "2026-08-01", toYMD: "2026-08-10" });
    const previous = resolvePreviousPeriod("custom", current);
    expect(ist(previous.from)).toBe("2026-07-22 00:00:00");
    expect(ist(previous.to)).toBe("2026-07-31 23:59:59");
  });

  it("gives a single-day custom range a single-day comparison", () => {
    const current = resolveDateRangePreset("custom", NOW, { fromYMD: "2026-08-05", toYMD: "2026-08-05" });
    const previous = resolvePreviousPeriod("custom", current);
    expect(ist(previous.from)).toBe("2026-08-04 00:00:00");
    expect(ist(previous.to)).toBe("2026-08-04 23:59:59");
  });
});
