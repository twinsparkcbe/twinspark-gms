import "server-only";

import { IST_OFFSET_MS } from "@/lib/format";

/**
 * Shared IST wall-clock date math for the Dashboard module — used by both
 * trend.ts (chart bucketing) and date-range.ts (stat card date-range
 * presets), so "today"/"this week"/"this month" always mean the same thing
 * in both places. India has no DST, so a fixed offset is always correct.
 */

// Real UTC instant for an IST wall-clock date at 00:00 — same shift
// lib/format.ts's fromISTDateTimeLocalInput uses, just for a bare date
// instead of a datetime-local value.
export function istMidnightUTC(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day, 0, 0, 0) - IST_OFFSET_MS);
}

export interface ISTParts {
  year: number;
  month: number; // 0-indexed, matches Date's monthIndex
  day: number;
  weekday: number; // 0 = Sunday, matches Date#getUTCDay
}

// IST wall-clock Y/M/D (+ weekday) for an arbitrary instant — mirrors
// formatDate's shift-then-read-UTC-getters technique.
export function istParts(date: Date): ISTParts {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

export function mondayOf(parts: ISTParts): { year: number; month: number; day: number } {
  const mondayOffset = (parts.weekday + 6) % 7; // Mon->0, Tue->1, ..., Sun->6
  const monday = istMidnightUTC(parts.year, parts.month, parts.day - mondayOffset);
  const p = istParts(monday);
  return { year: p.year, month: p.month, day: p.day };
}
