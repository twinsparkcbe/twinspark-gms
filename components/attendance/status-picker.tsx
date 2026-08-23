"use client";

import { cn } from "@/lib/utils";
import type { AttendanceStatus } from "@/types/database.types";

/**
 * One click to mark a status, instead of open-dropdown → scan → click.
 *
 * On a ten-person roster that dropdown cost three interactions per person
 * before any times were entered. A segmented control makes it one, and shows
 * every row's state at a glance while scrolling the list — you can see who's
 * still unmarked without reading each row.
 *
 * Short labels because this control repeats on every row; the full wording
 * stays in the accessible name.
 */
const OPTIONS: { value: AttendanceStatus; short: string; full: string; activeClass: string }[] = [
  { value: "FULL_DAY", short: "Full", full: "Full Day", activeClass: "bg-success text-white" },
  { value: "FIRST_HALF", short: "1st", full: "First Half", activeClass: "bg-info text-white" },
  { value: "SECOND_HALF", short: "2nd", full: "Second Half", activeClass: "bg-channel-purple text-white" },
  { value: "ABSENT", short: "Absent", full: "Absent", activeClass: "bg-danger text-white" },
];

export function AttendanceStatusPicker({
  value,
  employeeName,
  disabled,
  onChange,
}: {
  value: AttendanceStatus | null;
  employeeName: string;
  disabled?: boolean;
  onChange: (status: AttendanceStatus) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={`Attendance status for ${employeeName}`}
      className="inline-flex w-full rounded-[10px] border border-neutral-200 bg-neutral-50 p-0.5"
    >
      {OPTIONS.map((option) => {
        const isActive = value === option.value;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={`${option.full} for ${employeeName}`}
            title={option.full}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex-1 rounded-[7px] px-2 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors outline-none",
              "focus-visible:ring-2 focus-visible:ring-brand-red/40 disabled:cursor-not-allowed disabled:opacity-50",
              isActive ? option.activeClass : "text-neutral-500 hover:bg-white hover:text-neutral-900"
            )}
          >
            {option.short}
          </button>
        );
      })}
    </div>
  );
}
