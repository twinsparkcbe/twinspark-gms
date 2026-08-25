import type { AttendanceRole, AttendanceStatus } from "@/types/database.types";

/** An employee on the attendance roster — this module's own record, with no
 * link to a login account (`profiles`) or to any business entity. */
export interface AttendanceEmployeeRow {
  id: string;
  /** Issued by the database ("001", "002", ...), never typed by the admin. */
  employeeCode: string;
  name: string;
  role: AttendanceRole;
  /** Who an OTHER_STAFF member actually is ("Watchman", "Accountant").
   * Always null for the other two roles — enforced by a DB CHECK. */
  otherRoleDescription: string | null;
  /** Per-day wage. Null means no rate recorded — never zero. */
  dailyWage: number | null;
  mobile: string | null;
  /** "YYYY-MM-DD" */
  joiningDate: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A stored attendance record. `workingMinutes` always comes from the DB's
 * generated column — never computed on write. */
export interface AttendanceRecordRow {
  id: string;
  employeeId: string;
  /** "YYYY-MM-DD" */
  attendanceDate: string;
  status: AttendanceStatus;
  /** "HH:MM", normalized from the DB's "HH:MM:SS". */
  checkIn: string | null;
  checkOut: string | null;
  workingMinutes: number;
  /** The wage in force when this record was first saved — frozen, so a
   * later raise can't rewrite what a past month says was earned. */
  dailyWage: number | null;
  /** DB-generated from status + dailyWage. Null when unpriced. */
  payableAmount: number | null;
}

/**
 * One line of the Daily Attendance table: an active employee, plus that
 * date's record if one exists yet. `record` is null for an employee who
 * hasn't been marked today — they still appear in the list, which is the
 * whole point of the screen.
 */
export interface DailyAttendanceRow {
  employee: AttendanceEmployeeRow;
  record: AttendanceRecordRow | null;
}

/** A record joined to enough employee detail to render a report row without
 * a second lookup. */
export interface AttendanceRecordWithEmployee extends AttendanceRecordRow {
  employeeCode: string;
  employeeName: string;
  employeeRole: AttendanceRole;
  employeeOtherRoleDescription: string | null;
}
