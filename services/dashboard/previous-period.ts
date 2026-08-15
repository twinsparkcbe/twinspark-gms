import "server-only";

import { istMidnightUTC, istParts } from "./ist-dates";
import type { DashboardDateRange, DateRangePreset } from "./date-range-types";

/**
 * Resolves the window a selected range should be compared against for the
 * Dashboard's "vs previous period" deltas (doc/dashboard-redesign-scope.md
 * §3f).
 *
 * Two rules drive everything here:
 *
 * 1. **Duration matching for in-progress periods.** On 12 August, "This
 *    Month" covers 12 days. Comparing that against all 31 days of July would
 *    make every month look like a collapse until the last day. So the
 *    comparison starts at the previous period's calendar start and runs for
 *    the same *elapsed* duration — 1–12 July, not 1–31 July.
 *
 * 2. **Never overlap the current window.** The comparison end is capped at
 *    the instant before `current.from`. This also fixes the calendar-overflow
 *    case: "This Month" on 31 March is 30 days elapsed, and 1 Feb + 30 days
 *    would land in March — the cap pulls it back to the end of February.
 *
 * "Last Month" is the deliberate exception: it's a *completed* period, and an
 * owner comparing July to June means the whole of June, not the first 31 days
 * of it. So it always spans the full preceding calendar month.
 *
 * All date math goes through the IST helpers, same as `resolveDateRangePreset`
 * and the chart's bucketing — "yesterday" must mean the same thing everywhere.
 */
export function resolvePreviousPeriod(preset: DateRangePreset, current: DashboardDateRange): DashboardDateRange {
  // The last instant that can't possibly overlap the selected range.
  const latestAllowedEnd = new Date(current.from.getTime() - 1);
  const elapsedMs = current.to.getTime() - current.from.getTime();

  // Custom ranges have no calendar anchor to step back from — the comparison
  // is simply the identically-sized window immediately before it.
  if (preset === "custom") {
    return { from: new Date(latestAllowedEnd.getTime() - elapsedMs), to: latestAllowedEnd };
  }

  const from = previousPeriodStart(preset, current.from);

  // A completed period compares against a whole calendar period, not a
  // duration-matched slice of one.
  if (preset === "last_month") {
    return { from, to: latestAllowedEnd };
  }

  const durationMatchedEnd = new Date(from.getTime() + elapsedMs);
  const to = durationMatchedEnd.getTime() < latestAllowedEnd.getTime() ? durationMatchedEnd : latestAllowedEnd;
  return { from, to };
}

/**
 * `current.from` is always the selected period's own calendar start (IST
 * midnight of day 1 / Monday / Jan 1 / quarter start), so stepping back one
 * period is a straight subtraction on those parts. `istMidnightUTC` delegates
 * to `Date.UTC`, which normalises out-of-range values — day 0 rolls to the
 * previous month, month -1 rolls to December of the previous year.
 */
function previousPeriodStart(preset: Exclude<DateRangePreset, "custom">, currentFrom: Date): Date {
  const { year, month, day } = istParts(currentFrom);

  switch (preset) {
    case "today":
      return istMidnightUTC(year, month, day - 1);
    case "this_week":
      return istMidnightUTC(year, month, day - 7);
    case "this_month":
    case "last_month":
      return istMidnightUTC(year, month - 1, 1);
    case "this_quarter":
      return istMidnightUTC(year, month - 3, 1);
    case "this_year":
      return istMidnightUTC(year - 1, 0, 1);
    default: {
      const exhaustiveCheck: never = preset;
      throw new Error(`Unknown date range preset: ${exhaustiveCheck}`);
    }
  }
}
