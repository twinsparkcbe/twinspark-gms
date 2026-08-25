import type { AttendanceStatus } from "@/types/database.types";

/**
 * Wage arithmetic, mirroring the DB's generated `payable_amount` column
 * (0033_attendance_salary.sql) so the figure previewed on screen and the
 * figure stored are produced by the same rule.
 *
 * Confirmed decisions: a half day pays exactly 50%, and hours worked never
 * affect pay — a Full Day is a Full Day whether it ran seven hours or ten.
 * Attendance status is the only input.
 */

/** What fraction of a day's wage each status earns. */
export const PAYABLE_FACTOR: Record<AttendanceStatus, number> = {
  FULL_DAY: 1,
  FIRST_HALF: 0.5,
  SECOND_HALF: 0.5,
  ABSENT: 0,
};

export function payableFactor(status: AttendanceStatus): number {
  return PAYABLE_FACTOR[status];
}

/**
 * What one day earns. Null wage in, null amount out — for every status,
 * absences included.
 *
 * Returning 0 for an unpriced day would make "we never recorded this
 * person's rate" indistinguishable from "this person earned nothing", and a
 * report would then total a wage bill that silently omits people.
 */
export function computePayableAmount(status: AttendanceStatus, dailyWage: number | null): number | null {
  if (dailyWage === null || dailyWage === undefined) return null;
  // Rounded to paise the same way the DB's round(daily_wage * 0.5, 2) does,
  // so a half day of an odd rate agrees to the last decimal.
  return Math.round(dailyWage * payableFactor(status) * 100) / 100;
}

export interface SalaryTotals {
  /** Days actually earned: full days count 1, half days 0.5, absences 0. */
  payableDays: number;
  /** Sum of every priced day in the period. */
  salaryPayable: number;
  /** Worked days with no wage recorded — the salary above excludes these,
   * so a non-zero count means the figure is incomplete and must be shown
   * as such rather than presented as a final total. */
  unpricedDays: number;
}

export const EMPTY_SALARY_TOTALS: SalaryTotals = { payableDays: 0, salaryPayable: 0, unpricedDays: 0 };

export interface PayableRecord {
  status: AttendanceStatus;
  dailyWage: number | null;
}

export function summarizeSalary(records: readonly PayableRecord[]): SalaryTotals {
  const totals: SalaryTotals = { ...EMPTY_SALARY_TOTALS };

  for (const record of records) {
    const factor = payableFactor(record.status);
    totals.payableDays += factor;

    const amount = computePayableAmount(record.status, record.dailyWage);
    if (amount === null) {
      // Only a day that would have been paid counts as unpriced — an absence
      // with no rate on file costs nothing either way, so flagging it would
      // be noise.
      if (factor > 0) totals.unpricedDays += 1;
      continue;
    }
    totals.salaryPayable += amount;
  }

  // Half days make this a running float sum; snap it back to a clean half.
  totals.payableDays = Math.round(totals.payableDays * 2) / 2;
  totals.salaryPayable = Math.round(totals.salaryPayable * 100) / 100;
  return totals;
}

/** "20", "20.5" — never "20.50", since these are days, not money. */
export function formatPayableDays(days: number): string {
  return Number.isInteger(days) ? String(days) : days.toFixed(1);
}
