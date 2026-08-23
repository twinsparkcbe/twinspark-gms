import { IST_OFFSET_MS } from "@/lib/format";

/**
 * "Today" as the garage would call it — IST wall clock, not the server's
 * timezone (which on Vercel is UTC). Without this, opening Daily Attendance
 * after 6:30pm IST would default to tomorrow's date.
 *
 * Same shift-then-read-UTC-getters technique as lib/format.ts's
 * toISTDateInput; kept here (rather than imported from services/dashboard)
 * so the attendance module has no cross-module dependency.
 */
export function istTodayYMD(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** First day of the IST month containing `ymd` — the default report range
 * start ("this month so far"). */
export function firstDayOfMonth(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

/**
 * Shift a "YYYY-MM-DD" by whole days. Used for the "Copy Yesterday" action —
 * done on the calendar date itself (via UTC noon, safely clear of any
 * boundary) rather than on an instant, so it can never land on the wrong day.
 */
export function shiftYMD(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days, 12));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}
