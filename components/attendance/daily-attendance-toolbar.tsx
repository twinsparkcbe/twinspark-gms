"use client";

import { CalendarDays, CheckCheck, CopyPlus, RotateCcw, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

// 150px, not the 110px this started at: a native <input type="time"> in a
// 12-hour locale renders "08:00 AM" plus a picker icon, and Tailwind's
// border-box sizing means the padding eats into that width — at 110px the
// meridiem was clipped clean off. px-2.5 rather than the Input default
// px-3.5 for the same reason; a time field has no placeholder needing the
// extra breathing room. Shared so the two fields can never drift apart.
const TIME_FIELD_CLASS = "h-9 w-[150px] rounded-[10px] px-2.5 text-sm";

/**
 * Everything needed to mark a normal day, in one bar.
 *
 * The ordering follows what the admin actually does: confirm the date, then
 * fill the common case in one click, then only touch the exceptions in the
 * table below, then save.
 */
export function DailyAttendanceToolbar({
  attendanceDate,
  shiftStart,
  shiftEnd,
  isShiftValid,
  unmarkedCount,
  totalCount,
  dirtyCount,
  isLoading,
  isSaving,
  canSave,
  onDateChange,
  onShiftStartChange,
  onShiftEndChange,
  onMarkAllFullDay,
  onCopyYesterday,
  onDiscard,
  onSave,
}: {
  attendanceDate: string;
  shiftStart: string;
  shiftEnd: string;
  isShiftValid: boolean;
  unmarkedCount: number;
  totalCount: number;
  dirtyCount: number;
  isLoading: boolean;
  isSaving: boolean;
  canSave: boolean;
  onDateChange: (value: string) => void;
  onShiftStartChange: (value: string) => void;
  onShiftEndChange: (value: string) => void;
  onMarkAllFullDay: () => void;
  onCopyYesterday: () => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const busy = isLoading || isSaving;
  const markedCount = totalCount - unmarkedCount;

  // Label tells the truth about what the button will touch: it fills only
  // the rows still unmarked, so it can never overwrite an exception the
  // admin has already recorded.
  const markAllLabel =
    unmarkedCount === 0 || unmarkedCount === totalCount
      ? "Mark All Full Day"
      : `Mark Remaining ${unmarkedCount} Full Day`;

  return (
    <div className="space-y-3 rounded-[14px] border border-neutral-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="attendance-date" className="text-[11px] font-semibold tracking-wide text-neutral-500 uppercase">
              Attendance Date
            </Label>
            <div className="flex items-center gap-2.5">
              <Input
                id="attendance-date"
                type="date"
                value={attendanceDate}
                disabled={busy}
                onChange={(e) => onDateChange(e.target.value)}
                className="h-9 w-[160px] rounded-[10px] text-sm"
              />
              <span className="hidden text-sm font-semibold whitespace-nowrap text-neutral-700 sm:inline">
                {formatDate(`${attendanceDate}T00:00:00Z`)}
              </span>
            </div>
          </div>

          {/* Drives every auto-filled time below. Visible and editable rather
              than hidden in settings, so the numbers being filled in are
              never a surprise. */}
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold tracking-wide text-neutral-500 uppercase">Shop Hours</Label>
            <div className="flex items-center gap-1.5">
              <Input
                type="time"
                aria-label="Shop opening time"
                value={shiftStart}
                disabled={busy}
                onChange={(e) => onShiftStartChange(e.target.value)}
                className={cn(TIME_FIELD_CLASS, !isShiftValid && "border-danger")}
              />
              <span className="text-sm text-neutral-400">to</span>
              <Input
                type="time"
                aria-label="Shop closing time"
                value={shiftEnd}
                disabled={busy}
                onChange={(e) => onShiftEndChange(e.target.value)}
                className={cn(TIME_FIELD_CLASS, !isShiftValid && "border-danger")}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {dirtyCount > 0 && (
            <Button type="button" variant="secondary" size="sm" className="rounded-[10px]" onClick={onDiscard} disabled={isSaving}>
              <RotateCcw className="size-4" />
              Discard
            </Button>
          )}
          <Button type="button" size="sm" className="rounded-[10px]" onClick={onSave} disabled={!canSave}>
            <Save className="size-4" />
            {isSaving ? "Saving..." : dirtyCount > 0 ? `Save Changes (${dirtyCount})` : "Save Changes"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="rounded-[10px]"
          onClick={onMarkAllFullDay}
          disabled={busy || unmarkedCount === 0 || !isShiftValid}
        >
          <CheckCheck className="size-4" />
          {markAllLabel}
        </Button>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="rounded-[10px]"
          onClick={onCopyYesterday}
          disabled={busy}
        >
          <CopyPlus className="size-4" />
          Copy Yesterday
        </Button>

        <span className="ml-auto flex items-center gap-1.5 text-xs font-medium text-neutral-500">
          <CalendarDays className="size-3.5" />
          {totalCount === 0
            ? "No active employees"
            : unmarkedCount === 0
              ? `All ${totalCount} marked`
              : `${markedCount} of ${totalCount} marked`}
        </span>
      </div>

      {!isShiftValid && (
        <p className="text-sm font-medium text-danger">
          Closing time must be later than opening time — auto-fill is paused until that&apos;s fixed.
        </p>
      )}
    </div>
  );
}
