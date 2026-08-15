// Deliberately has NO "server-only" import — this file holds the pieces of
// the Dashboard date-range filter that Client Components need directly
// (the preset type, its dropdown options, the error class). date-range.ts
// re-exports all of this too, but *that* file also has "import server-only"
// on it, so a Client Component must import from here, not there — same
// leaf-file split used for mobileNumberSchema/pinCodeSchema in
// services/online-orders/schemas.ts.

export type DateRangePreset = "today" | "this_week" | "this_month" | "last_month" | "this_quarter" | "this_year" | "custom";

export const DATE_RANGE_PRESET_OPTIONS: { value: DateRangePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "this_week", label: "This Week" },
  { value: "this_month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
  { value: "this_quarter", label: "This Quarter" },
  { value: "this_year", label: "This Year" },
  { value: "custom", label: "Custom Range" },
];

/**
 * How the comparison window reads in the "vs ₹X …" line under each hero
 * figure. Kept beside the presets so the two can never drift apart — a range
 * labelled "This Quarter" must never say "vs last month".
 */
export const COMPARISON_LABELS: Record<DateRangePreset, string> = {
  today: "yesterday",
  this_week: "last week",
  this_month: "last month",
  last_month: "the month before",
  this_quarter: "last quarter",
  this_year: "last year",
  custom: "the previous period",
};

export interface DashboardDateRange {
  from: Date;
  to: Date;
}

export class InvalidDateRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDateRangeError";
  }
}
