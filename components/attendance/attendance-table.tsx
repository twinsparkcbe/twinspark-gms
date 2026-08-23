"use client";

import { CalendarCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import { computeWorkingMinutes, formatWorkingHours } from "@/services/attendance/working-hours";
import type { AttendanceRole, AttendanceStatus } from "@/types/database.types";

import { AttendanceRoleBadge } from "./attendance-badges";
import { AttendanceStatusPicker } from "./status-picker";

/** One row's editable state. `status: null` means "not marked yet" — an
 * active employee with no record for this date, which is deliberately not
 * the same thing as Absent. */
export interface AttendanceDraft {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  employeeRole: AttendanceRole;
  employeeOtherRoleDescription: string | null;
  status: AttendanceStatus | null;
  checkIn: string;
  checkOut: string;
  /** True while the times are the ones the shift defaults produced, false
   * once a human has typed over them. Decides whether editing the shop hours
   * is allowed to re-derive this row — see applyShiftChange. */
  isAutoFilled: boolean;
  /** Set by the parent from validateAttendanceTimes — blocks Save. */
  error: string | null;
  /** True once the row differs from what's stored, so Save sends only what
   * actually changed. */
  isDirty: boolean;
}

// Employee | Role | Status | Check In | Check Out | Working Hours
// Time columns are 140px, not 120: a native time input renders "08:58 AM"
// plus a picker icon, and anything tighter clips the meridiem.
const ROW_GRID_CLASS = "grid grid-cols-[minmax(150px,1fr)_130px_250px_140px_140px_100px] gap-2.5";

const TIME_INPUT_CLASS =
  "h-9 w-full rounded-[10px] border bg-white px-2.5 text-sm text-neutral-900 outline-none focus-visible:ring-2 disabled:bg-neutral-50 disabled:text-neutral-300";

export function AttendanceTable({
  drafts,
  isSaving,
  onChange,
}: {
  drafts: AttendanceDraft[];
  isSaving: boolean;
  onChange: (
    employeeId: string,
    patch: Partial<Pick<AttendanceDraft, "status" | "checkIn" | "checkOut">>
  ) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <div role="table" aria-label="Daily attendance" aria-busy={isSaving} className="min-w-[960px]">
        <div
          role="row"
          className={cn(ROW_GRID_CLASS, "px-3 py-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase")}
        >
          <span>Employee</span>
          <span>Role</span>
          <span>Status</span>
          <span>Check In</span>
          <span>Check Out</span>
          <span className="text-right">Hours</span>
        </div>

        <div className={cn("flex flex-col gap-1.5", isSaving && "opacity-60 transition-opacity")}>
          {drafts.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <CalendarCheck className="size-10 text-neutral-300" />
              <p className="text-sm font-medium text-neutral-700">No active employees</p>
              <p className="text-sm text-neutral-500">
                Add staff on the Employees tab — they&apos;ll appear here to mark.
              </p>
            </div>
          )}

          {drafts.map((draft) => {
            // Rule 4 — an absent employee has no times, so the inputs are
            // cleared and disabled rather than merely ignored on save.
            const isAbsent = draft.status === "ABSENT";
            const isUnmarked = draft.status === null;
            const minutes = isAbsent ? 0 : computeWorkingMinutes(draft.checkIn, draft.checkOut);
            const hasHours = !isAbsent && draft.checkIn !== "" && draft.checkOut !== "" && !draft.error;

            return (
              <div
                key={draft.employeeId}
                role="row"
                className={cn(
                  ROW_GRID_CLASS,
                  "items-center rounded-[10px] border px-3 py-2 transition-colors",
                  draft.error
                    ? "border-danger/50 bg-danger-bg/40"
                    : isUnmarked
                      // Unmarked rows stay visually open so the eye can find
                      // what's left to do without reading every row.
                      ? "border-dashed border-neutral-300 bg-neutral-50/60"
                      : "border-neutral-200 bg-white"
                )}
              >
                <div role="cell" aria-label="Employee" className="min-w-0">
                  <div className="truncate text-sm font-semibold text-neutral-900" title={draft.employeeName}>
                    {draft.employeeName}
                  </div>
                  <div className="truncate font-mono text-[11px] font-bold text-neutral-400">{draft.employeeCode}</div>
                  {draft.error && <p className="mt-0.5 text-xs font-medium text-danger">{draft.error}</p>}
                </div>

                <div role="cell" aria-label="Role" className="min-w-0">
                  <AttendanceRoleBadge
                    role={draft.employeeRole}
                    otherRoleDescription={draft.employeeOtherRoleDescription}
                  />
                </div>

                <div role="cell" aria-label="Attendance status" className="min-w-0">
                  <AttendanceStatusPicker
                    value={draft.status}
                    employeeName={draft.employeeName}
                    disabled={isSaving}
                    onChange={(status) => onChange(draft.employeeId, { status })}
                  />
                </div>

                <div role="cell" aria-label="Check in" className="min-w-0">
                  <input
                    type="time"
                    value={draft.checkIn}
                    disabled={isSaving || isAbsent || isUnmarked}
                    aria-label={`Check-in for ${draft.employeeName}`}
                    onChange={(e) => onChange(draft.employeeId, { checkIn: e.target.value })}
                    className={cn(TIME_INPUT_CLASS, "border-neutral-200 focus-visible:border-brand-red focus-visible:ring-brand-red/20")}
                  />
                </div>

                <div role="cell" aria-label="Check out" className="min-w-0">
                  <input
                    type="time"
                    value={draft.checkOut}
                    disabled={isSaving || isAbsent || isUnmarked}
                    aria-invalid={Boolean(draft.error) || undefined}
                    aria-label={`Check-out for ${draft.employeeName}`}
                    onChange={(e) => onChange(draft.employeeId, { checkOut: e.target.value })}
                    className={cn(
                      TIME_INPUT_CLASS,
                      draft.error
                        ? "border-danger focus-visible:border-danger focus-visible:ring-danger/20"
                        : "border-neutral-200 focus-visible:border-brand-red focus-visible:ring-brand-red/20"
                    )}
                  />
                </div>

                {/* Read-only, always — Rule 2. The value shown uses the same
                    formula as the DB's generated column, so what's on screen
                    while typing is what gets stored on save. */}
                <div
                  role="cell"
                  aria-label="Working hours"
                  className={cn(
                    "min-w-0 text-right font-mono text-sm font-bold",
                    hasHours ? "text-neutral-900" : "text-neutral-300"
                  )}
                >
                  {hasHours ? formatWorkingHours(minutes) : "—"}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
