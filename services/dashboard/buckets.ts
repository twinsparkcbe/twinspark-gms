import "server-only";

import { MONTH_ABBR } from "@/lib/format";

import { istMidnightUTC, istParts, mondayOf } from "./ist-dates";

export type TrendGranularity = "daily" | "weekly" | "monthly";

// How many bars each view shows — enough to read a trend, few enough that
// axis labels don't crowd on a dashboard-sized chart. Shared by every
// bucketed trend in the app (Dashboard's Track Tyre Sales chart, Reports'
// Revenue/Profit trend) so they all read the same at a glance.
const BUCKET_COUNT: Record<TrendGranularity, number> = { daily: 14, weekly: 8, monthly: 6 };

export interface Bucket {
  label: string;
  fullLabel: string;
  /** [start, end) as real UTC instants covering this bucket in IST. */
  start: Date;
  end: Date;
}

/**
 * Builds the [start, end) bucket boundaries for a trend chart, ending on
 * "now" — extracted from services/dashboard/trend.ts (2026-08-02, alongside
 * the Reports module, doc/reports-scope.md §7/§8) so Revenue/Profit trend
 * can bucket the exact same way Dashboard's Track Tyre Sales chart already
 * does, instead of a second, subtly-different implementation.
 */
export function buildBuckets(granularity: TrendGranularity, now: Date): Bucket[] {
  const today = istParts(now);
  const count = BUCKET_COUNT[granularity];
  const buckets: Bucket[] = [];

  if (granularity === "daily") {
    for (let i = count - 1; i >= 0; i--) {
      const start = istMidnightUTC(today.year, today.month, today.day - i);
      const end = istMidnightUTC(today.year, today.month, today.day - i + 1);
      const p = istParts(start);
      buckets.push({
        label: `${p.day} ${MONTH_ABBR[p.month]}`,
        fullLabel: `${p.day} ${MONTH_ABBR[p.month]} ${p.year}`,
        start,
        end,
      });
    }
  } else if (granularity === "weekly") {
    const thisMonday = mondayOf(today);
    for (let i = count - 1; i >= 0; i--) {
      const start = istMidnightUTC(thisMonday.year, thisMonday.month, thisMonday.day - i * 7);
      const end = istMidnightUTC(thisMonday.year, thisMonday.month, thisMonday.day - i * 7 + 7);
      const startParts = istParts(start);
      const endParts = istParts(new Date(end.getTime() - 1)); // last ms still inside the week
      buckets.push({
        label: `${startParts.day} ${MONTH_ABBR[startParts.month]}`,
        fullLabel: `${startParts.day} ${MONTH_ABBR[startParts.month]} - ${endParts.day} ${MONTH_ABBR[endParts.month]} ${endParts.year}`,
        start,
        end,
      });
    }
  } else {
    for (let i = count - 1; i >= 0; i--) {
      const monthIndex = today.month - i;
      const start = istMidnightUTC(today.year, monthIndex, 1);
      const end = istMidnightUTC(today.year, monthIndex + 1, 1);
      const p = istParts(start);
      buckets.push({
        label: `${MONTH_ABBR[p.month]} ${String(p.year).slice(-2)}`,
        fullLabel: `${MONTH_ABBR[p.month]} ${p.year}`,
        start,
        end,
      });
    }
  }

  return buckets;
}

/** Index of the bucket an ISO timestamp falls into, or -1 if it's outside every bucket. */
export function findBucketIndex(buckets: Bucket[], iso: string): number {
  const t = new Date(iso).getTime();
  return buckets.findIndex((b) => t >= b.start.getTime() && t < b.end.getTime());
}
