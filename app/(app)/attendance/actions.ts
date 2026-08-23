"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/require-admin";
import { createClient } from "@/lib/supabase/server";
import {
  createAttendanceEmployee,
  getDailyAttendance,
  getEmployeeAttendanceReport,
  listActiveAttendanceEmployees,
  listAttendanceEmployees,
  listAttendanceRecords,
  saveDailyAttendance,
  setAttendanceEmployeeActive,
  updateAttendanceEmployee,
  type AttendanceEmployeeInput,
  type AttendanceEmployeeRow,
  type AttendanceRecordWithEmployee,
  type AttendanceReportFilter,
  type DailyAttendanceRow,
  type EmployeeAttendanceReport,
  type SaveDailyAttendanceInput,
} from "@/services/attendance";

/**
 * Server Actions for the Attendance module.
 *
 * Every action re-checks Admin access server-side — never trust the client,
 * and never assume the layout's guard ran. Attendance is Admin-only, same
 * gate as Reports and Settings.
 *
 * Nothing here revalidates, reads or writes any path outside /attendance:
 * this module has no effect on Sales, Service, Inventory, Purchases,
 * Billing, Customer Orders or stock, by construction.
 */

type ActionResult<T = undefined> = { success: true; data: T } | { success: false; error: string };

function toErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

async function attendanceClient() {
  await requireAdmin();
  return createClient();
}

function revalidateAttendance() {
  revalidatePath("/attendance");
  revalidatePath("/attendance/employees");
  revalidatePath("/attendance/reports");
}

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

export async function fetchAttendanceEmployeesAction(): Promise<ActionResult<AttendanceEmployeeRow[]>> {
  try {
    const supabase = await attendanceClient();
    return { success: true, data: await listAttendanceEmployees(supabase) };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load employees.") };
  }
}

export async function fetchActiveAttendanceEmployeesAction(): Promise<ActionResult<AttendanceEmployeeRow[]>> {
  try {
    const supabase = await attendanceClient();
    return { success: true, data: await listActiveAttendanceEmployees(supabase) };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load employees.") };
  }
}

export async function createAttendanceEmployeeAction(
  input: AttendanceEmployeeInput
): Promise<ActionResult<AttendanceEmployeeRow>> {
  try {
    const supabase = await attendanceClient();
    const data = await createAttendanceEmployee(supabase, input);
    revalidateAttendance();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to create employee.") };
  }
}

export async function updateAttendanceEmployeeAction(
  id: string,
  input: AttendanceEmployeeInput
): Promise<ActionResult<AttendanceEmployeeRow>> {
  try {
    const supabase = await attendanceClient();
    const data = await updateAttendanceEmployee(supabase, id, input);
    revalidateAttendance();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to update employee.") };
  }
}

export async function setAttendanceEmployeeActiveAction(
  id: string,
  isActive: boolean
): Promise<ActionResult<AttendanceEmployeeRow>> {
  try {
    const supabase = await attendanceClient();
    const data = await setAttendanceEmployeeActive(supabase, id, isActive);
    revalidateAttendance();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to update employee status.") };
  }
}

// ---------------------------------------------------------------------------
// Daily attendance
// ---------------------------------------------------------------------------

export async function fetchDailyAttendanceAction(attendanceDate: string): Promise<ActionResult<DailyAttendanceRow[]>> {
  try {
    const supabase = await attendanceClient();
    return { success: true, data: await getDailyAttendance(supabase, attendanceDate) };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load attendance.") };
  }
}

/**
 * Saves the edited rows for one date. The input schema re-validates Rules 3
 * and 4 server-side (a browser can always be bypassed), and the DB's unique
 * constraint plus upsert enforce Rule 1 regardless.
 */
export async function saveDailyAttendanceAction(
  input: SaveDailyAttendanceInput
): Promise<ActionResult<DailyAttendanceRow[]>> {
  try {
    const supabase = await attendanceClient();
    await saveDailyAttendance(supabase, input);
    revalidateAttendance();
    // Return the freshly re-read day rather than just the written rows, so
    // the screen shows the DB's generated working_minutes rather than the
    // client's optimistic preview of them.
    return { success: true, data: await getDailyAttendance(supabase, input.attendanceDate) };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to save attendance.") };
  }
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export async function fetchAttendanceReportAction(
  filter: AttendanceReportFilter
): Promise<ActionResult<AttendanceRecordWithEmployee[]>> {
  try {
    const supabase = await attendanceClient();
    return { success: true, data: await listAttendanceRecords(supabase, filter) };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to generate the report.") };
  }
}

export async function fetchEmployeeAttendanceReportAction(
  employeeId: string,
  from: string,
  to: string
): Promise<ActionResult<EmployeeAttendanceReport>> {
  try {
    const supabase = await attendanceClient();
    return { success: true, data: await getEmployeeAttendanceReport(supabase, employeeId, from, to) };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load the employee report.") };
  }
}
