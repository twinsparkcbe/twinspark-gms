import type { AttendanceStatus } from "@/types/database.types";

import type { AttendanceRecordRow, AttendanceRecordWithEmployee, DailyAttendanceRow } from "./types";

/**
 * Pure aggregation for every count the module displays. No Supabase
 * dependency — the reports fetch rows once and roll them up here, which
 * keeps the numbers on the daily screen, the employee report and the monthly
 * summary provably consistent with each other (they run the same code).
 */

export interface DailySummary {
  totalEmployees: number;
  present: number;
  fullDay: number;
  firstHalf: number;
  secondHalf: number;
  absent: number;
  /** Active employees with no record saved for this date yet. */
  unmarked: number;
}

/**
 * The six summary cards above Daily Attendance.
 *
 * "Present" counts anyone marked Full Day, First Half or Second Half — a
 * half day is still a day someone turned up. Unmarked employees count
 * towards neither Present nor Absent: not yet recorded is a different fact
 * from recorded as away, and silently folding them into Absent would make
 * an untouched screen read as "everyone missing".
 */
export function deriveDailySummary(rows: DailyAttendanceRow[]): DailySummary {
  const summary: DailySummary = {
    totalEmployees: rows.length,
    present: 0,
    fullDay: 0,
    firstHalf: 0,
    secondHalf: 0,
    absent: 0,
    unmarked: 0,
  };

  for (const row of rows) {
    if (!row.record) {
      summary.unmarked += 1;
      continue;
    }

    switch (row.record.status) {
      case "FULL_DAY":
        summary.fullDay += 1;
        summary.present += 1;
        break;
      case "FIRST_HALF":
        summary.firstHalf += 1;
        summary.present += 1;
        break;
      case "SECOND_HALF":
        summary.secondHalf += 1;
        summary.present += 1;
        break;
      case "ABSENT":
        summary.absent += 1;
        break;
    }
  }

  return summary;
}

export interface AttendanceTotals {
  /** Days with any record at all — present days plus absent days. */
  recordedDays: number;
  /** Days actually worked (full + first half + second half). */
  workingDays: number;
  fullDays: number;
  firstHalfDays: number;
  secondHalfDays: number;
  absentDays: number;
  totalWorkingMinutes: number;
  /** Mean minutes per *working* day — dividing by recorded days would drag
   * the average down for every absence, which isn't what "average working
   * hours" means to the person reading it. Zero when nothing was worked. */
  averageWorkingMinutes: number;
}

const EMPTY_TOTALS: AttendanceTotals = {
  recordedDays: 0,
  workingDays: 0,
  fullDays: 0,
  firstHalfDays: 0,
  secondHalfDays: 0,
  absentDays: 0,
  totalWorkingMinutes: 0,
  averageWorkingMinutes: 0,
};

const PRESENT_STATUSES: readonly AttendanceStatus[] = ["FULL_DAY", "FIRST_HALF", "SECOND_HALF"];

/** Footer figures for the individual employee report (§6) and one row of the
 * date-range / monthly reports (§7, §8). */
export function summarizeAttendance(records: readonly AttendanceRecordRow[]): AttendanceTotals {
  const totals: AttendanceTotals = { ...EMPTY_TOTALS };

  for (const record of records) {
    totals.recordedDays += 1;
    totals.totalWorkingMinutes += record.workingMinutes;

    if (PRESENT_STATUSES.includes(record.status)) totals.workingDays += 1;

    switch (record.status) {
      case "FULL_DAY":
        totals.fullDays += 1;
        break;
      case "FIRST_HALF":
        totals.firstHalfDays += 1;
        break;
      case "SECOND_HALF":
        totals.secondHalfDays += 1;
        break;
      case "ABSENT":
        totals.absentDays += 1;
        break;
    }
  }

  totals.averageWorkingMinutes =
    totals.workingDays > 0 ? Math.round(totals.totalWorkingMinutes / totals.workingDays) : 0;

  return totals;
}

export interface EmployeeAttendanceSummary extends AttendanceTotals {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  employeeRole: AttendanceRecordWithEmployee["employeeRole"];
  employeeOtherRoleDescription: string | null;
}

/**
 * Per-employee rollup for the Reports table (§7) and the Monthly Summary
 * (§8) — same shape for both, since the only difference between them is the
 * date range that produced the records.
 *
 * Driven by the records themselves rather than by the employee roster, so an
 * employee who has since been deactivated still appears for periods they
 * actually worked (Rule 6). Sorted by name for a stable, scannable table.
 */
export function summarizeByEmployee(records: readonly AttendanceRecordWithEmployee[]): EmployeeAttendanceSummary[] {
  const grouped = new Map<string, AttendanceRecordWithEmployee[]>();

  for (const record of records) {
    const bucket = grouped.get(record.employeeId);
    if (bucket) bucket.push(record);
    else grouped.set(record.employeeId, [record]);
  }

  return [...grouped.values()]
    .map((employeeRecords) => {
      const first = employeeRecords[0];
      return {
        employeeId: first.employeeId,
        employeeCode: first.employeeCode,
        employeeName: first.employeeName,
        employeeRole: first.employeeRole,
        employeeOtherRoleDescription: first.employeeOtherRoleDescription,
        ...summarizeAttendance(employeeRecords),
      };
    })
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

/** "2026-08" for a "2026-08-18" record date — pure string work, so no
 * timezone can shift a record into the wrong month (these are already IST
 * wall-clock dates, not instants). */
export function monthKeyOf(attendanceDate: string): string {
  return attendanceDate.slice(0, 7);
}

/** Records for one calendar month, ready for summarizeByEmployee. */
export function filterToMonth<T extends { attendanceDate: string }>(records: readonly T[], monthKey: string): T[] {
  return records.filter((record) => monthKeyOf(record.attendanceDate) === monthKey);
}

/** Distinct months present in a result set, newest first — drives the
 * Monthly Summary month picker without a second query. */
export function listMonthKeys(records: readonly { attendanceDate: string }[]): string[] {
  return [...new Set(records.map((record) => monthKeyOf(record.attendanceDate)))].sort((a, b) => b.localeCompare(a));
}
