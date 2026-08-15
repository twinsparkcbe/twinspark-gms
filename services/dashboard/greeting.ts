import "server-only";

import { IST_OFFSET_MS } from "@/lib/format";

import { istParts } from "./ist-dates";

/**
 * The dashboard header's greeting and date line.
 *
 * Both are resolved here, server-side, and passed down as plain strings —
 * never recomputed in a Client Component. Anything derived from `new Date()`
 * during a client render is a hydration mismatch waiting to happen (the
 * server renders "Good morning", the client rehydrates a second later and
 * could render "Good afternoon"), which is exactly what the project's SSR
 * standard rules out.
 *
 * IST, not the server's locale — the garage is in Coimbatore, and a UTC host
 * would greet "Good evening" at 9am local.
 */

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function istGreeting(now: Date = new Date()): string {
  const hour = new Date(now.getTime() + IST_OFFSET_MS).getUTCHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** e.g. "Wednesday, 12 August 2026". */
export function istTodayLabel(now: Date = new Date()): string {
  const { year, month, day, weekday } = istParts(now);
  return `${WEEKDAYS[weekday]}, ${day} ${MONTHS[month]} ${year}`;
}
