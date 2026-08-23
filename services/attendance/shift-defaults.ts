import type { AttendanceStatus } from "@/types/database.types";

import { normalizeTime, parseTimeToMinutes } from "./working-hours";

/**
 * Shop-hours defaults — the thing that turns marking a day from ~60
 * interactions into a handful.
 *
 * The realistic day at a garage is: everyone turned up and worked the shop's
 * normal hours. Making the admin type "09:00" and "20:00" ten times to
 * record that is the wrong default. Instead the shop's open/close times fill
 * in automatically the moment a status is picked, and the admin only touches
 * the times for the people who actually differed.
 *
 * Pure functions, no Supabase and no React — unit tested directly.
 */

export const DEFAULT_SHIFT_START = "09:00";
export const DEFAULT_SHIFT_END = "20:00";

/**
 * The changeover point between a first half and a second half — the midpoint
 * of the shop's own day rather than a hardcoded 13:00, so a garage running
 * 08:00–18:00 splits at 13:00 and one running 10:00–21:00 splits at 15:30
 * without anyone configuring a third time.
 *
 * Returns null when the shift itself is unusable (unparseable, or closing at
 * or before opening), which callers treat as "leave the times blank and let
 * the admin type them".
 */
export function midpointTime(shiftStart: string, shiftEnd: string): string | null {
  const start = parseTimeToMinutes(shiftStart);
  const end = parseTimeToMinutes(shiftEnd);
  if (start === null || end === null || end <= start) return null;

  const mid = Math.floor((start + end) / 2);
  return normalizeTime(`${Math.floor(mid / 60)}:${String(mid % 60).padStart(2, "0")}`);
}

export interface ShiftTimes {
  checkIn: string | null;
  checkOut: string | null;
}

const NO_TIMES: ShiftTimes = { checkIn: null, checkOut: null };

/**
 * What the times should become when a status is picked.
 *
 * Absent deliberately clears both (Rule 4). The half days each take one end
 * of the shop's day and meet at the midpoint, so First Half + Second Half
 * across two people covers exactly one full shift with no gap or overlap.
 */
export function defaultTimesForStatus(
  status: AttendanceStatus,
  shiftStart: string = DEFAULT_SHIFT_START,
  shiftEnd: string = DEFAULT_SHIFT_END
): ShiftTimes {
  if (status === "ABSENT") return NO_TIMES;

  const start = normalizeTime(shiftStart);
  const end = normalizeTime(shiftEnd);
  const mid = midpointTime(shiftStart, shiftEnd);
  if (!start || !end || !mid) return NO_TIMES;

  switch (status) {
    case "FULL_DAY":
      return { checkIn: start, checkOut: end };
    case "FIRST_HALF":
      return { checkIn: start, checkOut: mid };
    case "SECOND_HALF":
      return { checkIn: mid, checkOut: end };
  }
}

/** A shift the defaults can actually be derived from. */
export function isValidShift(shiftStart: string, shiftEnd: string): boolean {
  return midpointTime(shiftStart, shiftEnd) !== null;
}

/**
 * The minimum a row needs to expose for a shop-hours change to reflow it.
 * `isAutoFilled` is the load-bearing field: it records whether the times
 * currently in the row came from these defaults or were typed by a human.
 */
export interface ShiftAwareRow {
  status: AttendanceStatus | null;
  checkIn: string;
  checkOut: string;
  isAutoFilled: boolean;
}

/**
 * Re-derives times after the admin edits the shop hours.
 *
 * Only rows still holding auto-filled times move. A time the admin typed
 * themselves — "Arun actually got in at 09:45" — is a recorded fact and must
 * survive an unrelated change to the shop's opening time; silently rewriting
 * it would destroy real data the admin can't tell was lost.
 *
 * Rows that are unmarked or Absent have no times to derive, and an unusable
 * shift (blank, or closing at/before opening, which happens mid-keystroke)
 * leaves everything untouched rather than blanking the screen.
 */
export function applyShiftChange<T extends ShiftAwareRow>(
  rows: readonly T[],
  shiftStart: string,
  shiftEnd: string
): T[] {
  if (!isValidShift(shiftStart, shiftEnd)) return [...rows];

  return rows.map((row) => {
    if (!row.isAutoFilled || row.status === null || row.status === "ABSENT") return row;

    const { checkIn, checkOut } = defaultTimesForStatus(row.status, shiftStart, shiftEnd);
    if (!checkIn || !checkOut) return row;
    if (checkIn === row.checkIn && checkOut === row.checkOut) return row;

    return { ...row, checkIn, checkOut };
  });
}
