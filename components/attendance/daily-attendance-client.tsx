"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { deriveDailySummary } from "@/services/attendance/summary";
import { shiftYMD } from "@/services/attendance/ist-today";
import { applyShiftChange, defaultTimesForStatus } from "@/services/attendance/shift-defaults";
import type { DailyAttendanceRow } from "@/services/attendance/types";
import { validateAttendanceTimes } from "@/services/attendance/working-hours";
import type { AttendanceStatus } from "@/types/database.types";

import { fetchDailyAttendanceAction, saveDailyAttendanceAction } from "@/app/(app)/attendance/actions";

import { AttendanceTable, type AttendanceDraft } from "./attendance-table";
import { DailyAttendanceToolbar } from "./daily-attendance-toolbar";
import { DailySummaryStrip } from "./daily-summary-strip";
import { useShiftHours } from "./use-shift-hours";

/** Server rows -> editable drafts. Every active employee gets a row whether
 * or not they've been marked yet — that's the point of the screen. */
function toDrafts(rows: DailyAttendanceRow[]): AttendanceDraft[] {
  return rows.map((row) => ({
    employeeId: row.employee.id,
    employeeCode: row.employee.employeeCode,
    employeeName: row.employee.name,
    employeeRole: row.employee.role,
    employeeOtherRoleDescription: row.employee.otherRoleDescription,
    status: row.record?.status ?? null,
    checkIn: row.record?.checkIn ?? "",
    checkOut: row.record?.checkOut ?? "",
    // Whatever is already stored is a recorded fact, not a preview — editing
    // the shop hours must never rewrite it.
    isAutoFilled: false,
    error: null,
    isDirty: false,
  }));
}

/** Recomputes the two derived fields after any edit, so validation state and
 * dirtiness are never set by hand at a call site and can't drift apart. */
function reconcile(draft: AttendanceDraft, rows: DailyAttendanceRow[]): AttendanceDraft {
  const original = rows.find((row) => row.employee.id === draft.employeeId)?.record ?? null;

  return {
    ...draft,
    error: draft.status ? validateAttendanceTimes(draft.status, draft.checkIn || null, draft.checkOut || null) : null,
    isDirty:
      draft.status !== (original?.status ?? null) ||
      draft.checkIn !== (original?.checkIn ?? "") ||
      draft.checkOut !== (original?.checkOut ?? ""),
  };
}

/**
 * Daily Attendance — the screen the garage owner opens every single day.
 *
 * Designed around one observation: on a normal day everybody turned up and
 * worked the shop's normal hours. Marking that should not cost ten dropdowns
 * and twenty typed times. So the common case is one click ("Mark All Full
 * Day", which fills times from the shop hours), and the admin's remaining
 * effort is proportional to the number of *exceptions* — usually one or two
 * people — not to headcount.
 */
export function DailyAttendanceClient({
  initialDate,
  initialRows,
}: {
  initialDate: string;
  initialRows: DailyAttendanceRow[];
}) {
  const [attendanceDate, setAttendanceDate] = useState(initialDate);
  const [rows, setRows] = useState(initialRows);
  const [drafts, setDrafts] = useState<AttendanceDraft[]>(() => toDrafts(initialRows));
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const { shiftStart, shiftEnd, updateStart, updateEnd, isValid: isShiftValid } = useShiftHours();

  // Computed from the *saved* rows, not the drafts: these figures report
  // what's recorded for the day, and having them flicker while the admin
  // works would make them untrustworthy.
  const summary = useMemo(() => deriveDailySummary(rows), [rows]);

  const dirtyDrafts = drafts.filter((draft) => draft.isDirty && draft.status !== null);
  const unmarkedCount = drafts.filter((draft) => draft.status === null).length;
  const hasErrors = drafts.some((draft) => draft.error !== null);
  const canSave = dirtyDrafts.length > 0 && !hasErrors && !isSaving && !isLoading;

  const loadDate = useCallback(async (nextDate: string) => {
    setIsLoading(true);
    const result = await fetchDailyAttendanceAction(nextDate);
    setIsLoading(false);

    if (result.success) {
      setRows(result.data);
      setDrafts(toDrafts(result.data));
    } else {
      toast.error(result.error);
    }
  }, []);

  /**
   * Editing the shop hours re-derives every row that is still holding
   * auto-filled times, immediately — change 09:00 to 08:30 and the ten rows
   * you just filled follow at once, without having to re-pick each status.
   *
   * Rows carrying hand-typed times are left exactly as they are; see
   * applyShiftChange for why that distinction matters.
   */
  const reflowAutoFilledTimes = useCallback(
    (nextStart: string, nextEnd: string) => {
      setDrafts((prev) => applyShiftChange(prev, nextStart, nextEnd).map((draft) => reconcile(draft, rows)));
    },
    [rows]
  );

  function handleShiftStartChange(value: string) {
    updateStart(value);
    reflowAutoFilledTimes(value, shiftEnd);
  }

  function handleShiftEndChange(value: string) {
    updateEnd(value);
    reflowAutoFilledTimes(shiftStart, value);
  }

  function confirmDiscardIfDirty(message: string): boolean {
    return dirtyDrafts.length === 0 || window.confirm(message);
  }

  function handleDateChange(nextDate: string) {
    if (!nextDate) return;
    if (!confirmDiscardIfDirty("You have unsaved attendance changes. Discard them and change the date?")) return;

    setAttendanceDate(nextDate);
    void loadDate(nextDate);
  }

  function handleDraftChange(
    employeeId: string,
    patch: Partial<Pick<AttendanceDraft, "status" | "checkIn" | "checkOut">>
  ) {
    setDrafts((prev) =>
      prev.map((draft) => {
        if (draft.employeeId !== employeeId) return draft;

        const next = { ...draft, ...patch };

        // Picking a status fills the times from the shop's hours — the whole
        // point of the redesign. Only when the status itself changed, so a
        // hand-typed time is never overwritten by a later edit to the row.
        if (patch.status != null && patch.status !== draft.status) {
          const defaults = defaultTimesForStatus(patch.status, shiftStart, shiftEnd);
          next.checkIn = defaults.checkIn ?? "";
          next.checkOut = defaults.checkOut ?? "";
          next.isAutoFilled = true;
        }

        // The admin typed a time themselves — this row now owns its times and
        // a later shop-hours edit must leave them alone.
        if (patch.checkIn !== undefined || patch.checkOut !== undefined) {
          next.isAutoFilled = false;
        }

        return reconcile(next, rows);
      })
    );
  }

  /**
   * Fills every *unmarked* row with a full day. Deliberately leaves rows the
   * admin has already touched alone: mark the two absences first, then hit
   * this, and the absences survive.
   */
  function handleMarkAllFullDay() {
    const defaults = defaultTimesForStatus("FULL_DAY", shiftStart, shiftEnd);

    setDrafts((prev) =>
      prev.map((draft) =>
        draft.status !== null
          ? draft
          : reconcile(
              {
                ...draft,
                status: "FULL_DAY",
                checkIn: defaults.checkIn ?? "",
                checkOut: defaults.checkOut ?? "",
                isAutoFilled: true,
              },
              rows
            )
      )
    );
  }

  /**
   * Yesterday's pattern is usually today's — same people, same shift. Copies
   * status and times for everyone who has a record for the previous day;
   * anyone without one is left untouched rather than guessed at.
   */
  async function handleCopyYesterday() {
    if (!confirmDiscardIfDirty("You have unsaved changes. Replace them with yesterday's attendance?")) return;

    const yesterday = shiftYMD(attendanceDate, -1);

    setIsLoading(true);
    const result = await fetchDailyAttendanceAction(yesterday);
    setIsLoading(false);

    if (!result.success) {
      toast.error(result.error);
      return;
    }

    const byEmployee = new Map(
      result.data.filter((row) => row.record !== null).map((row) => [row.employee.id, row.record!])
    );

    if (byEmployee.size === 0) {
      toast.error("No attendance was recorded yesterday.");
      return;
    }

    let copied = 0;
    setDrafts((prev) =>
      prev.map((draft) => {
        const previous = byEmployee.get(draft.employeeId);
        if (!previous) return draft;
        copied += 1;
        return reconcile(
          {
            ...draft,
            status: previous.status,
            checkIn: previous.checkIn ?? "",
            checkOut: previous.checkOut ?? "",
            // Yesterday's actual times, not something derived from the shift.
            isAutoFilled: false,
          },
          rows
        );
      })
    );

    toast.success(`Copied yesterday's attendance for ${copied} ${copied === 1 ? "employee" : "employees"}. Review, then save.`);
  }

  async function handleSave() {
    if (!canSave) return;

    setIsSaving(true);
    const result = await saveDailyAttendanceAction({
      attendanceDate,
      entries: dirtyDrafts.map((draft) => ({
        employeeId: draft.employeeId,
        // Non-null by construction: dirtyDrafts filters out unmarked rows.
        status: draft.status as AttendanceStatus,
        checkIn: draft.checkIn || null,
        checkOut: draft.checkOut || null,
      })),
    });
    setIsSaving(false);

    if (result.success) {
      // Re-seed from the server's response so the hours on screen are the
      // DB's generated values, not the client's preview of them.
      setRows(result.data);
      setDrafts(toDrafts(result.data));
      toast.success(`Attendance saved for ${dirtyDrafts.length} ${dirtyDrafts.length === 1 ? "employee" : "employees"}.`);
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="space-y-3">
      <DailyAttendanceToolbar
        attendanceDate={attendanceDate}
        shiftStart={shiftStart}
        shiftEnd={shiftEnd}
        isShiftValid={isShiftValid}
        unmarkedCount={unmarkedCount}
        totalCount={drafts.length}
        dirtyCount={dirtyDrafts.length}
        isLoading={isLoading}
        isSaving={isSaving}
        canSave={canSave}
        onDateChange={handleDateChange}
        onShiftStartChange={handleShiftStartChange}
        onShiftEndChange={handleShiftEndChange}
        onMarkAllFullDay={handleMarkAllFullDay}
        onCopyYesterday={handleCopyYesterday}
        onDiscard={() => setDrafts(toDrafts(rows))}
        onSave={handleSave}
      />

      <DailySummaryStrip summary={summary} />

      {hasErrors && (
        <p className="rounded-[10px] border border-danger/40 bg-danger-bg px-3 py-2 text-sm font-medium text-danger">
          Fix the highlighted rows before saving.
        </p>
      )}

      <div className="rounded-[14px] border border-neutral-200 bg-white p-3 shadow-sm">
        <AttendanceTable drafts={drafts} isSaving={isSaving || isLoading} onChange={handleDraftChange} />
      </div>
    </div>
  );
}
