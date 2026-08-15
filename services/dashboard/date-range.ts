import "server-only";

import { istMidnightUTC, istParts, mondayOf } from "./ist-dates";
import { InvalidDateRangeError, type DashboardDateRange, type DateRangePreset } from "./date-range-types";

export * from "./date-range-types";

function parseYMD(value: string): { year: number; month: number; day: number } {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) throw new InvalidDateRangeError(`Invalid date "${value}" — expected YYYY-MM-DD.`);
  return { year: y, month: m - 1, day: d };
}

/**
 * Resolves a Dashboard date-range preset (or an explicit custom range) into
 * concrete [from, to] instants — same IST wall-clock semantics as the Track
 * Tyre Sales chart's bucketing (ist-dates.ts). `to` is the *inclusive* end
 * instant, matching getSalesStats/getPurchaseStats' own existing
 * `.lte("sale_date"/"purchase_date", to)` filter: an ongoing period (Today,
 * This Week, This Month, This Quarter, This Year) ends at `now` — exactly
 * what those functions' own current-month default already does. A completed
 * period (Last Month) or a custom range ends at the last instant of its
 * last day instead.
 */
export function resolveDateRangePreset(
  preset: DateRangePreset,
  now: Date = new Date(),
  custom?: { fromYMD: string; toYMD: string }
): DashboardDateRange {
  const today = istParts(now);

  switch (preset) {
    case "today":
      return { from: istMidnightUTC(today.year, today.month, today.day), to: now };

    case "this_week": {
      const monday = mondayOf(today);
      return { from: istMidnightUTC(monday.year, monday.month, monday.day), to: now };
    }

    case "this_month":
      return { from: istMidnightUTC(today.year, today.month, 1), to: now };

    case "last_month": {
      const from = istMidnightUTC(today.year, today.month - 1, 1);
      const to = new Date(istMidnightUTC(today.year, today.month, 1).getTime() - 1);
      return { from, to };
    }

    case "this_quarter": {
      const quarterStartMonth = Math.floor(today.month / 3) * 3;
      return { from: istMidnightUTC(today.year, quarterStartMonth, 1), to: now };
    }

    case "this_year":
      return { from: istMidnightUTC(today.year, 0, 1), to: now };

    case "custom": {
      if (!custom?.fromYMD || !custom?.toYMD) {
        throw new InvalidDateRangeError('Custom range requires both a "from" and "to" date.');
      }
      const fromParts = parseYMD(custom.fromYMD);
      const toParts = parseYMD(custom.toYMD);
      const from = istMidnightUTC(fromParts.year, fromParts.month, fromParts.day);
      const to = new Date(istMidnightUTC(toParts.year, toParts.month, toParts.day + 1).getTime() - 1);
      if (to.getTime() < from.getTime()) {
        throw new InvalidDateRangeError('The "to" date can\'t be before the "from" date.');
      }
      return { from, to };
    }

    default: {
      const exhaustiveCheck: never = preset;
      throw new InvalidDateRangeError(`Unknown date range preset: ${exhaustiveCheck}`);
    }
  }
}
