import { describe, expect, it } from "vitest";

import {
  computePayableAmount,
  formatPayableDays,
  payableFactor,
  summarizeSalary,
  type PayableRecord,
} from "./salary";

describe("payableFactor", () => {
  it("pays a half day exactly 50% and an absence nothing", () => {
    expect(payableFactor("FULL_DAY")).toBe(1);
    expect(payableFactor("FIRST_HALF")).toBe(0.5);
    expect(payableFactor("SECOND_HALF")).toBe(0.5);
    expect(payableFactor("ABSENT")).toBe(0);
  });
});

describe("computePayableAmount", () => {
  it("pays the full rate for a full day", () => {
    expect(computePayableAmount("FULL_DAY", 600)).toBe(600);
  });

  it("halves the rate for either half day", () => {
    expect(computePayableAmount("FIRST_HALF", 600)).toBe(300);
    expect(computePayableAmount("SECOND_HALF", 600)).toBe(300);
  });

  it("pays nothing for an absence", () => {
    expect(computePayableAmount("ABSENT", 600)).toBe(0);
  });

  /** Matches the DB's round(daily_wage * 0.5, 2). */
  it("rounds an odd rate to paise", () => {
    expect(computePayableAmount("FIRST_HALF", 575)).toBe(287.5);
    expect(computePayableAmount("FIRST_HALF", 333.33)).toBe(166.67);
  });

  /**
   * The distinction the whole design rests on: no rate on file is not the
   * same statement as "earned nothing", and that holds for absences too.
   */
  it("returns null for an unpriced day, whatever the status", () => {
    expect(computePayableAmount("FULL_DAY", null)).toBeNull();
    expect(computePayableAmount("FIRST_HALF", null)).toBeNull();
    expect(computePayableAmount("ABSENT", null)).toBeNull();
  });
});

const rec = (status: PayableRecord["status"], dailyWage: number | null): PayableRecord => ({ status, dailyWage });

describe("summarizeSalary", () => {
  it("totals a normal month", () => {
    const totals = summarizeSalary([
      rec("FULL_DAY", 600),
      rec("FULL_DAY", 600),
      rec("FIRST_HALF", 600),
      rec("SECOND_HALF", 600),
      rec("ABSENT", 600),
    ]);

    expect(totals.payableDays).toBe(3);          // 1 + 1 + 0.5 + 0.5 + 0
    expect(totals.salaryPayable).toBe(1800);
    expect(totals.unpricedDays).toBe(0);
  });

  it("keeps a half day visible in the day count", () => {
    expect(summarizeSalary([rec("FULL_DAY", 500), rec("FIRST_HALF", 500)]).payableDays).toBe(1.5);
  });

  /** Floating-point half days must not drift into 20.499999999. */
  it("does not accumulate float error across many half days", () => {
    const totals = summarizeSalary(Array.from({ length: 41 }, () => rec("FIRST_HALF", 100)));
    expect(totals.payableDays).toBe(20.5);
    expect(totals.salaryPayable).toBe(2050);
  });

  it("flags worked days that have no rate, and leaves them out of the total", () => {
    const totals = summarizeSalary([rec("FULL_DAY", 600), rec("FULL_DAY", null), rec("FIRST_HALF", null)]);

    expect(totals.payableDays).toBe(2.5);
    expect(totals.salaryPayable).toBe(600);      // only the priced day
    expect(totals.unpricedDays).toBe(2);
  });

  /** An unpriced absence costs nothing either way — flagging it is noise. */
  it("does not flag an unpriced absence", () => {
    const totals = summarizeSalary([rec("ABSENT", null)]);
    expect(totals.unpricedDays).toBe(0);
    expect(totals.salaryPayable).toBe(0);
  });

  /**
   * The point of snapshotting the rate onto each record: a raise partway
   * through a period must not reprice the days before it.
   */
  it("uses each record's own snapshotted rate, not a single current one", () => {
    const totals = summarizeSalary([
      rec("FULL_DAY", 500),   // before the raise
      rec("FULL_DAY", 500),
      rec("FULL_DAY", 700),   // after it
    ]);
    expect(totals.salaryPayable).toBe(1700);
  });

  it("returns zeroes for an empty period", () => {
    expect(summarizeSalary([])).toEqual({ payableDays: 0, salaryPayable: 0, unpricedDays: 0 });
  });
});

describe("formatPayableDays", () => {
  it("shows whole days plainly and halves to one decimal", () => {
    expect(formatPayableDays(20)).toBe("20");
    expect(formatPayableDays(20.5)).toBe("20.5");
    expect(formatPayableDays(0)).toBe("0");
  });
});
