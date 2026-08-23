import { describe, expect, it } from "vitest";

import {
  computeWorkingMinutes,
  formatTotalHours,
  formatWorkingHours,
  normalizeTime,
  parseTimeToMinutes,
  validateAttendanceTimes,
} from "./working-hours";

describe("parseTimeToMinutes", () => {
  it("parses HH:MM and HH:MM:SS alike", () => {
    expect(parseTimeToMinutes("09:10")).toBe(550);
    expect(parseTimeToMinutes("09:10:00")).toBe(550);
    expect(parseTimeToMinutes("00:00")).toBe(0);
    expect(parseTimeToMinutes("23:59")).toBe(1439);
  });

  it("returns null for missing or malformed values", () => {
    expect(parseTimeToMinutes(null)).toBeNull();
    expect(parseTimeToMinutes(undefined)).toBeNull();
    expect(parseTimeToMinutes("")).toBeNull();
    expect(parseTimeToMinutes("9")).toBeNull();
    expect(parseTimeToMinutes("24:00")).toBeNull();
    expect(parseTimeToMinutes("09:60")).toBeNull();
    expect(parseTimeToMinutes("nine")).toBeNull();
  });
});

describe("normalizeTime", () => {
  it("drops seconds and zero-pads the hour", () => {
    expect(normalizeTime("09:05:00")).toBe("09:05");
    expect(normalizeTime("9:05")).toBe("09:05");
    expect(normalizeTime("18:15")).toBe("18:15");
  });

  it("returns null rather than throwing on junk", () => {
    expect(normalizeTime("")).toBeNull();
    expect(normalizeTime("later")).toBeNull();
  });
});

describe("computeWorkingMinutes", () => {
  /** The worked example from the client's spec: 09:10 -> 18:15 = 09h 05m. */
  it("matches the spec's worked example", () => {
    const minutes = computeWorkingMinutes("09:10", "18:15");
    expect(minutes).toBe(545);
    expect(formatWorkingHours(minutes)).toBe("09h 05m");
  });

  it("handles half days", () => {
    expect(formatWorkingHours(computeWorkingMinutes("09:20", "13:05"))).toBe("03h 45m");
    expect(formatWorkingHours(computeWorkingMinutes("13:00", "18:20"))).toBe("05h 20m");
  });

  it("is zero when either end is missing — an absent or half-entered day", () => {
    expect(computeWorkingMinutes(null, null)).toBe(0);
    expect(computeWorkingMinutes("09:10", null)).toBe(0);
    expect(computeWorkingMinutes(null, "18:15")).toBe(0);
  });

  /**
   * Mirrors `greatest(0, ...)` in the generated column: the CHECK constraint
   * already rejects this, but the helper must never hand the UI a negative.
   */
  it("clamps a reversed span to zero rather than going negative", () => {
    expect(computeWorkingMinutes("18:15", "09:10")).toBe(0);
  });
});

describe("formatWorkingHours", () => {
  it("zero-pads both parts", () => {
    expect(formatWorkingHours(0)).toBe("00h 00m");
    expect(formatWorkingHours(5)).toBe("00h 05m");
    expect(formatWorkingHours(60)).toBe("01h 00m");
    expect(formatWorkingHours(545)).toBe("09h 05m");
  });

  it("never renders a negative duration", () => {
    expect(formatWorkingHours(-30)).toBe("00h 00m");
  });
});

describe("formatTotalHours", () => {
  it("drops the leading zero for report totals that run past 99 hours", () => {
    expect(formatTotalHours(10470)).toBe("174h 30m");
    expect(formatTotalHours(545)).toBe("9h 05m");
    expect(formatTotalHours(0)).toBe("0h 00m");
  });
});

describe("validateAttendanceTimes", () => {
  it("accepts a normal full day", () => {
    expect(validateAttendanceTimes("FULL_DAY", "09:10", "18:15")).toBeNull();
  });

  /** Rule 4 — an absent employee has no check-in/check-out. */
  it("rejects times on an absent record", () => {
    expect(validateAttendanceTimes("ABSENT", "09:10", "18:15")).toMatch(/absent/i);
    expect(validateAttendanceTimes("ABSENT", "09:10", null)).toMatch(/absent/i);
    expect(validateAttendanceTimes("ABSENT", null, null)).toBeNull();
  });

  /** Rule 3 — check-out cannot be earlier than check-in. */
  it("rejects a check-out at or before check-in", () => {
    expect(validateAttendanceTimes("FULL_DAY", "18:15", "09:10")).toMatch(/later than check-in/i);
    expect(validateAttendanceTimes("FULL_DAY", "09:10", "09:10")).toMatch(/later than check-in/i);
  });

  it("allows a present employee who has checked in but not out yet", () => {
    expect(validateAttendanceTimes("FIRST_HALF", "09:20", null)).toBeNull();
    expect(validateAttendanceTimes("SECOND_HALF", null, null)).toBeNull();
  });
});
