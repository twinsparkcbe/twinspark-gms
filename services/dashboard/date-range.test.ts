import { describe, expect, it } from "vitest";

import { InvalidDateRangeError, resolveDateRangePreset } from "./date-range";

// Wed 29 Jul 2026, 10:00 UTC = 15:30 IST — same fixed "now" used in
// trend.test.ts, so IST calendar day/week/month/quarter/year are all
// unambiguous for these assertions.
const NOW = new Date("2026-07-29T10:00:00.000Z");

describe("resolveDateRangePreset — ongoing periods end at `now`", () => {
  it("today: starts at today's IST midnight, ends at now", () => {
    const { from, to } = resolveDateRangePreset("today", NOW);
    expect(from.toISOString()).toBe(new Date("2026-07-28T18:30:00.000Z").toISOString()); // 29 Jul 00:00 IST
    expect(to).toBe(NOW);
  });

  it("this_week: starts at Monday's IST midnight, ends at now", () => {
    const { from, to } = resolveDateRangePreset("this_week", NOW);
    // 29 Jul 2026 is a Wednesday — Monday of that week is 27 Jul.
    expect(from.toISOString()).toBe(new Date("2026-07-26T18:30:00.000Z").toISOString()); // 27 Jul 00:00 IST
    expect(to).toBe(NOW);
  });

  it("this_month: starts at the 1st of the month IST midnight, ends at now", () => {
    const { from, to } = resolveDateRangePreset("this_month", NOW);
    expect(from.toISOString()).toBe(new Date("2026-06-30T18:30:00.000Z").toISOString()); // 1 Jul 00:00 IST
    expect(to).toBe(NOW);
  });

  it("this_quarter: starts at the quarter's first month, ends at now", () => {
    const { from, to } = resolveDateRangePreset("this_quarter", NOW);
    // July is the first month of Q3 (Jul-Sep) — quarter start == month start here.
    expect(from.toISOString()).toBe(new Date("2026-06-30T18:30:00.000Z").toISOString()); // 1 Jul 00:00 IST
    expect(to).toBe(NOW);
  });

  it("this_year: starts at Jan 1 IST midnight, ends at now", () => {
    const { from, to } = resolveDateRangePreset("this_year", NOW);
    expect(from.toISOString()).toBe(new Date("2025-12-31T18:30:00.000Z").toISOString()); // 1 Jan 2026 00:00 IST
    expect(to).toBe(NOW);
  });
});

describe("resolveDateRangePreset — completed periods have a fixed end", () => {
  it("last_month: spans the entirety of the previous calendar month", () => {
    const { from, to } = resolveDateRangePreset("last_month", NOW);
    expect(from.toISOString()).toBe(new Date("2026-05-31T18:30:00.000Z").toISOString()); // 1 Jun 00:00 IST
    expect(to.toISOString()).toBe(new Date("2026-06-30T18:29:59.999Z").toISOString()); // 30 Jun 23:59:59.999 IST
  });
});

describe("resolveDateRangePreset — custom range", () => {
  it("spans from the start of `from` to the end of `to`, both IST calendar days", () => {
    const { from, to } = resolveDateRangePreset("custom", NOW, { fromYMD: "2026-07-01", toYMD: "2026-07-15" });
    expect(from.toISOString()).toBe(new Date("2026-06-30T18:30:00.000Z").toISOString()); // 1 Jul 00:00 IST
    expect(to.toISOString()).toBe(new Date("2026-07-15T18:29:59.999Z").toISOString()); // 15 Jul 23:59:59.999 IST
  });

  it("supports a single-day range (from === to)", () => {
    const { from, to } = resolveDateRangePreset("custom", NOW, { fromYMD: "2026-07-10", toYMD: "2026-07-10" });
    expect(from.getTime()).toBeLessThan(to.getTime());
  });

  it("throws when fromYMD/toYMD are missing", () => {
    expect(() => resolveDateRangePreset("custom", NOW)).toThrow(InvalidDateRangeError);
  });

  it("throws when to is before from", () => {
    expect(() =>
      resolveDateRangePreset("custom", NOW, { fromYMD: "2026-07-15", toYMD: "2026-07-01" })
    ).toThrow(InvalidDateRangeError);
  });

  it("throws on a malformed date string", () => {
    expect(() =>
      resolveDateRangePreset("custom", NOW, { fromYMD: "not-a-date", toYMD: "2026-07-01" })
    ).toThrow(InvalidDateRangeError);
  });
});
