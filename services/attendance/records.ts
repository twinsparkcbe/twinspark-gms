import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

import { listActiveAttendanceEmployees, mapEmployeeRow } from "./employees";
import {
  attendanceReportFilterSchema,
  saveDailyAttendanceSchema,
  type AttendanceReportFilter,
  type SaveDailyAttendanceInput,
} from "./schemas";
import { normalizeTime } from "./working-hours";
import type { AttendanceEmployeeRow, AttendanceRecordRow, AttendanceRecordWithEmployee, DailyAttendanceRow } from "./types";

/**
 * Attendance records (0031_attendance_module.sql).
 *
 * `working_minutes` is never written from here — it's a stored generated
 * column, so every write deliberately omits it and every read takes the DB's
 * value (Rules 2 and 7). The client-side helpers in working-hours.ts mirror
 * the same formula for live preview only.
 */

export class DuplicateAttendanceError extends Error {
  constructor() {
    super("That employee already has an attendance record for this date.");
    this.name = "DuplicateAttendanceError";
  }
}

export class InvalidAttendanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAttendanceError";
  }
}

/** Exactly the columns RECORD_COLUMNS selects — not the full table Row, so
 * the mapper's input type stays honest about what a query actually returns
 * (created_at/updated_at are never selected; nothing renders them). */
type RecordDbRow = Pick<
  Database["public"]["Tables"]["attendance_records"]["Row"],
  "id" | "employee_id" | "attendance_date" | "status" | "check_in" | "check_out" | "working_minutes"
>;
type EmployeeDbRow = Database["public"]["Tables"]["attendance_employees"]["Row"];

const RECORD_COLUMNS = "id, employee_id, attendance_date, status, check_in, check_out, working_minutes";
const EMPLOYEE_COLUMNS =
  "id, employee_code, name, role, other_role_description, mobile, joining_date, is_active, created_at, updated_at";

const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";

function toErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function mapRecordRow(row: RecordDbRow): AttendanceRecordRow {
  return {
    id: row.id,
    employeeId: row.employee_id,
    attendanceDate: row.attendance_date,
    status: row.status,
    // Postgres hands back "09:10:00"; the UI's <input type="time"> wants
    // "09:10". Normalizing here means no component has to know that.
    checkIn: normalizeTime(row.check_in),
    checkOut: normalizeTime(row.check_out),
    workingMinutes: row.working_minutes,
  };
}

/**
 * Translates the DB's constraint names back into the same messages the
 * client-side validation shows, so a rejection that only the database could
 * have caught (a stale tab, a concurrent edit) still reads like a normal
 * validation error rather than a raw Postgres string.
 */
function toConstraintError(error: { code?: string; message?: string } | null): Error | null {
  if (!error) return null;
  if (error.code === UNIQUE_VIOLATION) return new DuplicateAttendanceError();

  if (error.code === CHECK_VIOLATION) {
    const message = error.message ?? "";
    if (message.includes("absent_has_no_times")) {
      return new InvalidAttendanceError("An absent employee can't have check-in or check-out times.");
    }
    if (message.includes("checkout_after_checkin")) {
      return new InvalidAttendanceError("Check-out must be later than check-in.");
    }
    return new InvalidAttendanceError("That attendance entry isn't valid.");
  }

  return null;
}

/**
 * The Daily Attendance screen's data: every ACTIVE employee (Rule 5), each
 * paired with their record for this date if one exists.
 *
 * Two queries rather than a join, on purpose — an employee with no record
 * yet must still appear as a row to mark, and a left join through PostgREST
 * can't express "all employees, plus the record for exactly this one date"
 * without an embedded filter that's harder to read than this.
 */
export async function getDailyAttendance(
  supabase: SupabaseClient<Database>,
  attendanceDate: string
): Promise<DailyAttendanceRow[]> {
  const [employees, { data: records, error }] = await Promise.all([
    listActiveAttendanceEmployees(supabase),
    supabase.from("attendance_records").select(RECORD_COLUMNS).eq("attendance_date", attendanceDate),
  ]);

  if (error) throw new Error(toErrorMessage(error, "Failed to load attendance."));

  const byEmployee = new Map((records ?? []).map((row) => [row.employee_id, mapRecordRow(row)]));

  return employees.map((employee) => ({ employee, record: byEmployee.get(employee.id) ?? null }));
}

/**
 * Saves a whole day in one round trip.
 *
 * Upserts on the `(employee_id, attendance_date)` unique constraint, which
 * is what makes Rule 1 hold no matter how many times Save is pressed or how
 * many tabs are open — the second write updates the first record rather than
 * creating a duplicate. Times are force-nulled for ABSENT (Rule 4) instead
 * of trusting the caller to have cleared them.
 */
export async function saveDailyAttendance(
  supabase: SupabaseClient<Database>,
  rawInput: SaveDailyAttendanceInput
): Promise<AttendanceRecordRow[]> {
  const input = saveDailyAttendanceSchema.parse(rawInput);

  const payload = input.entries.map((entry) => ({
    employee_id: entry.employeeId,
    attendance_date: input.attendanceDate,
    status: entry.status,
    check_in: entry.status === "ABSENT" ? null : entry.checkIn,
    check_out: entry.status === "ABSENT" ? null : entry.checkOut,
    // working_minutes deliberately absent — generated by the DB.
  }));

  const { data, error } = await supabase
    .from("attendance_records")
    .upsert(payload, { onConflict: "employee_id,attendance_date" })
    .select(RECORD_COLUMNS);

  const constraintError = toConstraintError(error);
  if (constraintError) throw constraintError;
  if (error) throw new Error(toErrorMessage(error, "Failed to save attendance."));

  return (data ?? []).map(mapRecordRow);
}

type JoinedRecordDbRow = RecordDbRow & {
  attendance_employees: Pick<EmployeeDbRow, "employee_code" | "name" | "role" | "other_role_description"> | null;
};

function mapJoinedRow(row: JoinedRecordDbRow): AttendanceRecordWithEmployee {
  return {
    ...mapRecordRow(row),
    // The FK is `not null` with `on delete restrict`, so the embedded row is
    // always present — the fallbacks exist only to keep the mapper total.
    employeeCode: row.attendance_employees?.employee_code ?? "",
    employeeName: row.attendance_employees?.name ?? "Unknown",
    employeeRole: row.attendance_employees?.role ?? "OTHER_STAFF",
    employeeOtherRoleDescription: row.attendance_employees?.other_role_description ?? null,
  };
}

/**
 * Records for the reports, joined to enough employee detail to render a row.
 *
 * Queries records rather than the roster on purpose (Rule 6): a deactivated
 * employee's history stays visible in every report covering a period they
 * worked. The role filter is applied to the embedded employee row with
 * `!inner`, so it filters rather than merely nulling the join.
 */
export async function listAttendanceRecords(
  supabase: SupabaseClient<Database>,
  rawFilter: AttendanceReportFilter
): Promise<AttendanceRecordWithEmployee[]> {
  const filter = attendanceReportFilterSchema.parse(rawFilter);

  let query = supabase
    .from("attendance_records")
    .select(`${RECORD_COLUMNS}, attendance_employees!inner (employee_code, name, role, other_role_description)`)
    .gte("attendance_date", filter.from)
    .lte("attendance_date", filter.to);

  if (filter.employeeId) query = query.eq("employee_id", filter.employeeId);
  if (filter.role) query = query.eq("attendance_employees.role", filter.role);

  const { data, error } = await query.order("attendance_date", { ascending: false });

  if (error) throw new Error(toErrorMessage(error, "Failed to load attendance records."));

  return (data as unknown as JoinedRecordDbRow[] | null ?? []).map(mapJoinedRow);
}

export interface EmployeeAttendanceReport {
  employee: AttendanceEmployeeRow;
  records: AttendanceRecordRow[];
}

/**
 * One employee's records over a range (§6). Reads the employee row directly
 * rather than through the active roster, so the report still opens for
 * someone who has since been deactivated.
 */
export async function getEmployeeAttendanceReport(
  supabase: SupabaseClient<Database>,
  employeeId: string,
  from: string,
  to: string
): Promise<EmployeeAttendanceReport> {
  const [{ data: employee, error: employeeError }, { data: records, error: recordsError }] = await Promise.all([
    supabase.from("attendance_employees").select(EMPLOYEE_COLUMNS).eq("id", employeeId).maybeSingle(),
    supabase
      .from("attendance_records")
      .select(RECORD_COLUMNS)
      .eq("employee_id", employeeId)
      .gte("attendance_date", from)
      .lte("attendance_date", to)
      .order("attendance_date", { ascending: false }),
  ]);

  if (employeeError) throw new Error(toErrorMessage(employeeError, "Failed to load employee."));
  if (!employee) throw new Error("Employee not found.");
  if (recordsError) throw new Error(toErrorMessage(recordsError, "Failed to load attendance records."));

  return { employee: mapEmployeeRow(employee), records: (records ?? []).map(mapRecordRow) };
}
