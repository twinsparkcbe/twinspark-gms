import type { AttendanceStatus } from "@/types/database.types";

/**
 * Pure working-hour math — no Supabase dependency, so it's trivially unit
 * testable (same split as services/inventory/rules.ts).
 *
 * The DB's generated `working_minutes` column
 * (0031_attendance_module.sql) is the source of truth for anything stored.
 * These helpers mirror that exact logic so the admin sees the hours update
 * live while typing, before anything is saved — they are never the value
 * that gets written.
 */

/** Minutes since midnight for a "HH:MM" or "HH:MM:SS" wall-clock time. */
export function parseTimeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;

  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;

  return hours * 60 + minutes;
}

/**
 * Normalizes a time for storage/comparison: "9:5" is rejected, "09:05:00"
 * and "09:05" both become "09:05". Returns null for anything unparseable,
 * which the callers treat as "no time entered".
 */
export function normalizeTime(value: string | null | undefined): string | null {
  const minutes = parseTimeToMinutes(value);
  if (minutes === null) return null;

  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Working duration in whole minutes. Zero whenever either end is missing
 * (an Absent day, or a half-finished entry) or the span is non-positive —
 * matching the `case ... else greatest(0, ...)` in the generated column.
 */
export function computeWorkingMinutes(checkIn: string | null | undefined, checkOut: string | null | undefined): number {
  const start = parseTimeToMinutes(checkIn);
  const end = parseTimeToMinutes(checkOut);
  if (start === null || end === null) return 0;
  return Math.max(0, end - start);
}

/** "09h 05m" — the format the client asked for, zero-padded on both parts. */
export function formatWorkingHours(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const hh = String(Math.floor(safe / 60)).padStart(2, "0");
  const mm = String(safe % 60).padStart(2, "0");
  return `${hh}h ${mm}m`;
}

/** Same figure rendered for report totals, where a leading zero on a
 * three-digit hour count would look wrong: "174h 30m". */
export function formatTotalHours(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  return `${Math.floor(safe / 60)}h ${String(safe % 60).padStart(2, "0")}m`;
}

/**
 * Business Rules 3 and 4, in one place so the inline table, the Zod schema
 * and the server action all reject exactly the same inputs the DB's CHECK
 * constraints do. Returns a user-facing message, or null when valid.
 */
export function validateAttendanceTimes(
  status: AttendanceStatus,
  checkIn: string | null | undefined,
  checkOut: string | null | undefined
): string | null {
  const start = parseTimeToMinutes(checkIn);
  const end = parseTimeToMinutes(checkOut);

  // Rule 4 — an absent employee has no times at all.
  if (status === "ABSENT") {
    return start !== null || end !== null ? "An absent employee can't have check-in or check-out times." : null;
  }

  // A present employee part-way through the day is allowed: check-in
  // recorded, check-out still blank. Hours simply read as zero until the
  // second half is filled in.
  if (start === null || end === null) return null;

  // Rule 3 — equal times are rejected too: a zero-minute working day is a
  // mis-entry, not a fact. This is also why overnight shifts are out of scope.
  if (end <= start) return "Check-out must be later than check-in.";

  return null;
}
