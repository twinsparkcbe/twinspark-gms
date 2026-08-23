import { z } from "zod";

import type { AttendanceRole, AttendanceStatus } from "@/types/database.types";

import { normalizeTime, validateAttendanceTimes } from "./working-hours";

// Order here is the order every role dropdown in the module renders in.
export const ATTENDANCE_ROLES = ["SALES_PERSON", "SERVICE_PERSON", "OTHER_STAFF"] as const;
export const ATTENDANCE_STATUSES = ["FULL_DAY", "FIRST_HALF", "SECOND_HALF", "ABSENT"] as const;

export const ATTENDANCE_ROLE_LABELS: Record<AttendanceRole, string> = {
  SALES_PERSON: "Sales Person",
  SERVICE_PERSON: "Service Person",
  OTHER_STAFF: "Other Staff",
};

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  FULL_DAY: "Full Day",
  FIRST_HALF: "First Half",
  SECOND_HALF: "Second Half",
  ABSENT: "Absent",
};

/** "YYYY-MM-DD", the shape a native <input type="date"> produces. */
export const ymdSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Enter a valid date");

/** Empty string from an untouched <input type="time"> means "not entered". */
const optionalTimeSchema = z
  .string()
  .trim()
  .transform((value) => normalizeTime(value))
  .nullable()
  .catch(null);

/**
 * Indian mobile number, optional — the roster is internal, and the garage
 * owner shouldn't be blocked from adding a staff member whose number they
 * don't have to hand. Same 10-digit rule as services/shared/mobile.ts, kept
 * local rather than imported so this module stays free of cross-module
 * dependencies (doc/attendance-module-scope.md §"Independence").
 */
const optionalMobileSchema = z
  .string()
  .trim()
  .max(15)
  .refine((value) => value === "" || /^[6-9]\d{9}$/.test(value), "Enter a valid 10-digit mobile number")
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .default(null);

/**
 * `employeeCode` is deliberately absent: the database issues it from a
 * sequence ("001", "002", ...), so there is nothing for the admin — or a
 * client crafting its own request — to submit.
 */
export const attendanceEmployeeInputSchema = z
  .object({
    name: z.string().trim().min(1, "Employee name is required").max(120),
    role: z.enum(ATTENDANCE_ROLES),
    otherRoleDescription: z
      .string()
      .trim()
      .max(60, "Keep it short — e.g. Watchman, Accountant")
      .transform((value) => (value === "" ? null : value))
      .nullable()
      .default(null),
    mobile: optionalMobileSchema,
    joiningDate: ymdSchema,
    isActive: z.boolean().default(true),
  })
  .superRefine((input, ctx) => {
    // "Other Staff" on its own says nothing useful about who someone is, so
    // the description is mandatory for that role...
    if (input.role === "OTHER_STAFF" && !input.otherRoleDescription) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Say what this person does — e.g. Watchman, Accountant, Cleaner.",
        path: ["otherRoleDescription"],
      });
    }
  })
  // ...and forbidden for the other two, so switching a role can never leave
  // a stale job title behind. Stripped here rather than rejected: the DB
  // CHECK enforces the same thing, and silently clearing is the kinder
  // behaviour for a field the UI has already hidden.
  .transform((input) => ({
    ...input,
    otherRoleDescription: input.role === "OTHER_STAFF" ? input.otherRoleDescription : null,
  }));

export type AttendanceEmployeeInput = z.input<typeof attendanceEmployeeInputSchema>;
export type AttendanceEmployeeParsed = z.output<typeof attendanceEmployeeInputSchema>;

/**
 * What to show in a "Role" column. For Other Staff the description is the
 * useful thing to read ("Watchman"), not the bucket it lives in — a table
 * listing four people as "Other Staff" tells the owner nothing.
 */
export function roleDisplayLabel(role: AttendanceRole, otherRoleDescription?: string | null): string {
  if (role === "OTHER_STAFF" && otherRoleDescription) return otherRoleDescription;
  return ATTENDANCE_ROLE_LABELS[role];
}

/**
 * One row of the Daily Attendance table. `workingMinutes` is deliberately
 * absent — Rule 2: the admin never submits it, the DB generates it. A client
 * that tried to send one would simply have it dropped here.
 */
export const attendanceEntrySchema = z
  .object({
    employeeId: z.string().uuid("Unknown employee"),
    status: z.enum(ATTENDANCE_STATUSES),
    checkIn: optionalTimeSchema,
    checkOut: optionalTimeSchema,
  })
  .superRefine((entry, ctx) => {
    const error = validateAttendanceTimes(entry.status, entry.checkIn, entry.checkOut);
    if (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error,
        // Points at check_out, because that's the field the admin has to
        // change in both failure modes.
        path: ["checkOut"],
      });
    }
  });

export type AttendanceEntryInput = z.infer<typeof attendanceEntrySchema>;

export const saveDailyAttendanceSchema = z.object({
  attendanceDate: ymdSchema,
  entries: z.array(attendanceEntrySchema).min(1, "Nothing to save"),
});

export type SaveDailyAttendanceInput = z.infer<typeof saveDailyAttendanceSchema>;

/** Reports filters — employee and role both default to "all" (undefined). */
export const attendanceReportFilterSchema = z
  .object({
    employeeId: z.string().uuid().optional(),
    role: z.enum(ATTENDANCE_ROLES).optional(),
    from: ymdSchema,
    to: ymdSchema,
  })
  .refine((filter) => filter.from <= filter.to, {
    message: "The start date must be on or before the end date.",
    path: ["to"],
  });

export type AttendanceReportFilter = z.infer<typeof attendanceReportFilterSchema>;
