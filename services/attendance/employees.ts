import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

import { attendanceEmployeeInputSchema, type AttendanceEmployeeInput } from "./schemas";
import type { AttendanceEmployeeRow } from "./types";

/**
 * Attendance's own employee roster (0031_attendance_module.sql).
 *
 * Deliberately NOT `profiles`: the people whose attendance is marked are not
 * the same set as the people who can log in. Coupling them would mean an HR
 * change silently granting or revoking application access.
 *
 * Uses the plain RLS-scoped client, like Inventory/Purchases — the
 * service-role client exists for `auth.admin.*` (services/users), which
 * nothing here touches. Every caller is already behind requireAdmin(), and
 * the table's RLS policies are admin-only besides.
 */

/**
 * Employee codes are issued by a DB sequence, so this is unreachable through
 * the UI. Kept because the unique index is still real: a code inserted by
 * hand in the SQL editor could collide with one the sequence later hands out,
 * and a clear message beats a raw Postgres error if that ever happens.
 */
export class DuplicateEmployeeCodeError extends Error {
  constructor(code?: string) {
    super(code ? `Employee ID "${code}" is already in use.` : "That Employee ID is already in use.");
    this.name = "DuplicateEmployeeCodeError";
  }
}

export class AttendanceEmployeeNotFoundError extends Error {
  constructor() {
    super("Employee not found.");
    this.name = "AttendanceEmployeeNotFoundError";
  }
}

type EmployeeDbRow = Database["public"]["Tables"]["attendance_employees"]["Row"];

const SELECT_COLUMNS =
  "id, employee_code, name, role, other_role_description, mobile, joining_date, is_active, created_at, updated_at";

/** Postgres unique_violation — the case-insensitive employee-code index. */
const UNIQUE_VIOLATION = "23505";

export function mapEmployeeRow(row: EmployeeDbRow): AttendanceEmployeeRow {
  return {
    id: row.id,
    employeeCode: row.employee_code,
    name: row.name,
    role: row.role,
    otherRoleDescription: row.other_role_description,
    mobile: row.mobile,
    joiningDate: row.joining_date,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function isUniqueViolation(error: PostgrestError | null): boolean {
  return error?.code === UNIQUE_VIOLATION;
}

/**
 * The whole roster, active and inactive. Deactivated employees are still
 * listed here (that's how they get reactivated) — it's the *Daily
 * Attendance* query that filters to active only, per Rule 5. Filtering by
 * search/role/status happens client-side, same reasoning as the Users
 * screen: this is one garage's staff list, not a paginated dataset.
 */
export async function listAttendanceEmployees(
  supabase: SupabaseClient<Database>
): Promise<AttendanceEmployeeRow[]> {
  const { data, error } = await supabase
    .from("attendance_employees")
    .select(SELECT_COLUMNS)
    .order("name", { ascending: true });

  if (error) throw new Error(toErrorMessage(error, "Failed to load employees."));

  return (data ?? []).map(mapEmployeeRow);
}

/** Active employees only, ordered by name — the Daily Attendance roster and
 * the Reports employee filter (Rule 5). */
export async function listActiveAttendanceEmployees(
  supabase: SupabaseClient<Database>
): Promise<AttendanceEmployeeRow[]> {
  const { data, error } = await supabase
    .from("attendance_employees")
    .select(SELECT_COLUMNS)
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) throw new Error(toErrorMessage(error, "Failed to load employees."));

  return (data ?? []).map(mapEmployeeRow);
}

export async function getAttendanceEmployee(
  supabase: SupabaseClient<Database>,
  id: string
): Promise<AttendanceEmployeeRow> {
  const { data, error } = await supabase.from("attendance_employees").select(SELECT_COLUMNS).eq("id", id).maybeSingle();

  if (error) throw new Error(toErrorMessage(error, "Failed to load employee."));
  if (!data) throw new AttendanceEmployeeNotFoundError();

  return mapEmployeeRow(data);
}

export async function createAttendanceEmployee(
  supabase: SupabaseClient<Database>,
  rawInput: AttendanceEmployeeInput
): Promise<AttendanceEmployeeRow> {
  const input = attendanceEmployeeInputSchema.parse(rawInput);

  const { data, error } = await supabase
    .from("attendance_employees")
    // employee_code is deliberately omitted — the DB's sequence default
    // issues "001", "002", ... Sending one would defeat the point.
    .insert({
      name: input.name,
      role: input.role,
      other_role_description: input.otherRoleDescription,
      mobile: input.mobile,
      joining_date: input.joiningDate,
      is_active: input.isActive,
    })
    .select(SELECT_COLUMNS)
    .single();

  if (isUniqueViolation(error)) throw new DuplicateEmployeeCodeError();
  if (error || !data) throw new Error(toErrorMessage(error, "Failed to create employee."));

  return mapEmployeeRow(data);
}

export async function updateAttendanceEmployee(
  supabase: SupabaseClient<Database>,
  id: string,
  rawInput: AttendanceEmployeeInput
): Promise<AttendanceEmployeeRow> {
  const input = attendanceEmployeeInputSchema.parse(rawInput);

  const { data, error } = await supabase
    .from("attendance_employees")
    // employee_code is never updated either — an ID that changes is worse
    // than useless on a roster people refer to by number.
    .update({
      name: input.name,
      role: input.role,
      other_role_description: input.otherRoleDescription,
      mobile: input.mobile,
      joining_date: input.joiningDate,
      is_active: input.isActive,
    })
    .eq("id", id)
    .select(SELECT_COLUMNS)
    .maybeSingle();

  if (isUniqueViolation(error)) throw new DuplicateEmployeeCodeError();
  if (error) throw new Error(toErrorMessage(error, "Failed to update employee."));
  if (!data) throw new AttendanceEmployeeNotFoundError();

  return mapEmployeeRow(data);
}

/**
 * Activate/deactivate. Rules 5 and 6: a deactivated employee drops out of
 * new Daily Attendance lists, but every record they already have stays
 * queryable — which is why this module has no delete at all (there's no
 * DELETE policy on the table and the FK is `on delete restrict`).
 */
export async function setAttendanceEmployeeActive(
  supabase: SupabaseClient<Database>,
  id: string,
  isActive: boolean
): Promise<AttendanceEmployeeRow> {
  const { data, error } = await supabase
    .from("attendance_employees")
    .update({ is_active: isActive })
    .eq("id", id)
    .select(SELECT_COLUMNS)
    .maybeSingle();

  if (error) throw new Error(toErrorMessage(error, "Failed to update employee status."));
  if (!data) throw new AttendanceEmployeeNotFoundError();

  return mapEmployeeRow(data);
}
