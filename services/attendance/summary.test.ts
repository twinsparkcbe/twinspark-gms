import { describe, expect, it } from "vitest";

import {
  deriveDailySummary,
  filterToMonth,
  listMonthKeys,
  monthKeyOf,
  summarizeAttendance,
  summarizeByEmployee,
} from "./summary";
import type { AttendanceEmployeeRow, AttendanceRecordRow, AttendanceRecordWithEmployee, DailyAttendanceRow } from "./types";

function employee(overrides: Partial<AttendanceEmployeeRow> = {}): AttendanceEmployeeRow {
  return {
    id: "emp-1",
    employeeCode: "EMP01",
    name: "Arun",
    role: "SALES_PERSON",
    otherRoleDescription: null,
    dailyWage: 600,
    mobile: null,
    joiningDate: "2026-01-01",
    isActive: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function record(overrides: Partial<AttendanceRecordRow> = {}): AttendanceRecordRow {
  return {
    id: "rec-1",
    employeeId: "emp-1",
    attendanceDate: "2026-08-18",
    status: "FULL_DAY",
    checkIn: "09:10",
    checkOut: "18:15",
    workingMinutes: 545,
    dailyWage: 600,
    payableAmount: 600,
    ...overrides,
  };
}

function row(employeeOverrides: Partial<AttendanceEmployeeRow>, recordOverrides: Partial<AttendanceRecordRow> | null): DailyAttendanceRow {
  return {
    employee: employee(employeeOverrides),
    record: recordOverrides === null ? null : record({ employeeId: employeeOverrides.id ?? "emp-1", ...recordOverrides }),
  };
}

describe("deriveDailySummary", () => {
  it("counts each status and treats every half day as present", () => {
    const summary = deriveDailySummary([
      row({ id: "a" }, { status: "FULL_DAY" }),
      row({ id: "b" }, { status: "FULL_DAY" }),
      row({ id: "c" }, { status: "FIRST_HALF" }),
      row({ id: "d" }, { status: "SECOND_HALF" }),
      row({ id: "e" }, { status: "ABSENT", checkIn: null, checkOut: null, workingMinutes: 0 }),
    ]);

    expect(summary).toEqual({
      totalEmployees: 5,
      present: 4,
      fullDay: 2,
      firstHalf: 1,
      secondHalf: 1,
      absent: 1,
      unmarked: 0,
    });
  });

  /**
   * The load-bearing distinction: an untouched screen must not read as
   * "everyone absent". Unmarked employees count towards neither present nor
   * absent.
   */
  it("counts unmarked employees separately from absent ones", () => {
    const summary = deriveDailySummary([
      row({ id: "a" }, { status: "FULL_DAY" }),
      row({ id: "b" }, null),
      row({ id: "c" }, null),
    ]);

    expect(summary.totalEmployees).toBe(3);
    expect(summary.present).toBe(1);
    expect(summary.absent).toBe(0);
    expect(summary.unmarked).toBe(2);
  });

  it("returns zeroes for an empty roster", () => {
    expect(deriveDailySummary([])).toEqual({
      totalEmployees: 0,
      present: 0,
      fullDay: 0,
      firstHalf: 0,
      secondHalf: 0,
      absent: 0,
      unmarked: 0,
    });
  });
});

describe("summarizeAttendance", () => {
  it("totals days by status and sums working minutes", () => {
    const totals = summarizeAttendance([
      record({ attendanceDate: "2026-08-01", status: "FULL_DAY", workingMinutes: 545 }),
      record({ attendanceDate: "2026-08-02", status: "FIRST_HALF", workingMinutes: 225 }),
      record({ attendanceDate: "2026-08-03", status: "SECOND_HALF", workingMinutes: 320 }),
      record({ attendanceDate: "2026-08-04", status: "ABSENT", checkIn: null, checkOut: null, workingMinutes: 0 }),
    ]);

    expect(totals.recordedDays).toBe(4);
    expect(totals.workingDays).toBe(3);
    expect(totals.fullDays).toBe(1);
    expect(totals.firstHalfDays).toBe(1);
    expect(totals.secondHalfDays).toBe(1);
    expect(totals.absentDays).toBe(1);
    expect(totals.totalWorkingMinutes).toBe(1090);
  });

  /** Absences must not drag the average down — "average working hours"
   * means per day worked, not per day on the calendar. */
  it("averages over working days only, not absences", () => {
    const totals = summarizeAttendance([
      record({ status: "FULL_DAY", workingMinutes: 600 }),
      record({ status: "FULL_DAY", workingMinutes: 500 }),
      record({ status: "ABSENT", checkIn: null, checkOut: null, workingMinutes: 0 }),
    ]);

    expect(totals.averageWorkingMinutes).toBe(550);
  });

  it("returns a zeroed total with no divide-by-zero for an empty range", () => {
    const totals = summarizeAttendance([]);
    expect(totals.recordedDays).toBe(0);
    expect(totals.averageWorkingMinutes).toBe(0);
  });

  it("averages to zero when every recorded day is an absence", () => {
    const totals = summarizeAttendance([record({ status: "ABSENT", checkIn: null, checkOut: null, workingMinutes: 0 })]);
    expect(totals.averageWorkingMinutes).toBe(0);
  });
});

function joined(overrides: Partial<AttendanceRecordWithEmployee> = {}): AttendanceRecordWithEmployee {
  return {
    ...record(),
    employeeCode: "EMP01",
    employeeName: "Arun",
    employeeRole: "SALES_PERSON",
    employeeOtherRoleDescription: null,
    ...overrides,
  };
}

describe("summarizeByEmployee", () => {
  it("groups records per employee and sorts by name", () => {
    const summaries = summarizeByEmployee([
      joined({ employeeId: "e2", employeeName: "Kumar", employeeCode: "EMP02", employeeRole: "SERVICE_PERSON", status: "FULL_DAY", workingMinutes: 540 }),
      joined({ employeeId: "e1", employeeName: "Arun", status: "FULL_DAY", workingMinutes: 545 }),
      joined({ employeeId: "e1", employeeName: "Arun", attendanceDate: "2026-08-19", status: "ABSENT", checkIn: null, checkOut: null, workingMinutes: 0 }),
    ]);

    expect(summaries.map((s) => s.employeeName)).toEqual(["Arun", "Kumar"]);

    const arun = summaries[0];
    expect(arun.recordedDays).toBe(2);
    expect(arun.workingDays).toBe(1);
    expect(arun.absentDays).toBe(1);
    expect(arun.totalWorkingMinutes).toBe(545);
    expect(arun.averageWorkingMinutes).toBe(545);
  });

  /**
   * Rule 6 — the rollup is driven by the records, not by the current active
   * roster, so someone who has since been deactivated still appears for the
   * period they actually worked.
   */
  it("includes an employee who no longer appears on the active roster", () => {
    const summaries = summarizeByEmployee([joined({ employeeId: "gone", employeeName: "Suresh", employeeCode: "EMP09" })]);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].employeeName).toBe("Suresh");
  });

  it("returns an empty list when there are no records", () => {
    expect(summarizeByEmployee([])).toEqual([]);
  });
});

describe("month helpers", () => {
  it("derives the month key by string slice, so no timezone can shift it", () => {
    expect(monthKeyOf("2026-08-01")).toBe("2026-08");
    expect(monthKeyOf("2026-08-31")).toBe("2026-08");
    expect(monthKeyOf("2026-09-01")).toBe("2026-09");
  });

  it("filters records to a single month", () => {
    const records = [
      joined({ attendanceDate: "2026-07-31" }),
      joined({ attendanceDate: "2026-08-01" }),
      joined({ attendanceDate: "2026-08-31" }),
      joined({ attendanceDate: "2026-09-01" }),
    ];
    expect(filterToMonth(records, "2026-08")).toHaveLength(2);
  });

  it("lists distinct months newest first", () => {
    expect(
      listMonthKeys([
        joined({ attendanceDate: "2026-07-15" }),
        joined({ attendanceDate: "2026-09-02" }),
        joined({ attendanceDate: "2026-08-18" }),
        joined({ attendanceDate: "2026-08-19" }),
      ])
    ).toEqual(["2026-09", "2026-08", "2026-07"]);
  });
});

/**
 * Salary rolls up through the same totals every other figure uses, so the
 * employee report footer and the Reports table can never disagree.
 */
describe("salary in the attendance totals", () => {
  it("adds payable days and salary to a per-employee summary", () => {
    const summaries = summarizeByEmployee([
      joined({ employeeId: "e1", status: "FULL_DAY", dailyWage: 600, payableAmount: 600 }),
      joined({ employeeId: "e1", attendanceDate: "2026-08-19", status: "FIRST_HALF", dailyWage: 600, payableAmount: 300 }),
      joined({ employeeId: "e1", attendanceDate: "2026-08-20", status: "ABSENT", checkIn: null, checkOut: null, workingMinutes: 0, dailyWage: 600, payableAmount: 0 }),
    ]);

    expect(summaries[0].payableDays).toBe(1.5);
    expect(summaries[0].salaryPayable).toBe(900);
    expect(summaries[0].unpricedDays).toBe(0);
  });

  /**
   * The reason the rate is snapshotted per record rather than read off the
   * employee: a raise must not reprice the days worked before it.
   */
  it("prices each day at the rate stored on that day's record", () => {
    const totals = summarizeAttendance([
      record({ attendanceDate: "2026-08-01", dailyWage: 500, payableAmount: 500 }),
      record({ attendanceDate: "2026-08-02", dailyWage: 500, payableAmount: 500 }),
      record({ attendanceDate: "2026-09-01", dailyWage: 700, payableAmount: 700 }),
    ]);
    expect(totals.salaryPayable).toBe(1700);
  });

  it("reports an employee with no rate as unpriced rather than as earning zero", () => {
    const totals = summarizeAttendance([
      record({ status: "FULL_DAY", dailyWage: null, payableAmount: null }),
      record({ attendanceDate: "2026-08-19", status: "FULL_DAY", dailyWage: null, payableAmount: null }),
    ]);

    expect(totals.payableDays).toBe(2);
    expect(totals.salaryPayable).toBe(0);
    expect(totals.unpricedDays).toBe(2);
  });
});
