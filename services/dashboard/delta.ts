// Deliberately has NO "server-only" import — the stat cards are rendered by a
// Client Component (DashboardStatsSection refetches on range change), so these
// pure formatters must be importable from the client. Same leaf-file split as
// date-range-types.ts.

/**
 * A period-over-period change, already resolved into the exact shape the UI
 * should render. Discriminated rather than a bare number because the honest
 * answer isn't always a percentage (doc/dashboard-redesign-scope.md §3g):
 *
 * - `none`     nothing happened in either period — show no delta at all
 * - `new`      first activity ever; "+∞%" / "+100%" would both be lies
 * - `percent`  the normal case, off a positive base
 * - `absolute` the base was zero-or-negative, where a % swing is meaningless
 *              ("+140%" off a −₹500 profit tells the owner nothing)
 */
export type MetricDelta =
  | { kind: "none" }
  | { kind: "new" }
  | { kind: "percent"; value: number; direction: DeltaDirection }
  | { kind: "absolute"; value: number; direction: DeltaDirection };

export type DeltaDirection = "up" | "down" | "flat";

function directionOf(current: number, previous: number): DeltaDirection {
  if (current > previous) return "up";
  if (current < previous) return "down";
  return "flat";
}

export function computeDelta(current: number, previous: number): MetricDelta {
  if (current === previous && previous === 0) return { kind: "none" };

  const direction = directionOf(current, previous);

  if (previous === 0) {
    // Genuinely the first activity in this metric. A negative "first" value
    // (a loss-making first month) still needs a magnitude, so it falls
    // through to absolute rather than reading as good news.
    return current > 0 ? { kind: "new" } : { kind: "absolute", value: current, direction };
  }

  if (previous < 0) {
    return { kind: "absolute", value: current - previous, direction };
  }

  return { kind: "percent", value: Math.round(((current - previous) / previous) * 100), direction };
}

/** "+18%" / "−100%" / "0%" — uses a real minus sign, not a hyphen. */
export function formatDeltaPercent(value: number): string {
  if (value === 0) return "0%";
  return value > 0 ? `+${value}%` : `−${Math.abs(value)}%`;
}

/**
 * Profit as a share of sales. `null` when nothing was sold — 0% would falsely
 * imply a break-even sale actually happened, so the UI renders "—" instead.
 */
export function computeMarginPercent(profit: number, salesAmount: number): number | null {
  if (salesAmount === 0) return null;
  return Math.round((profit / salesAmount) * 1000) / 10;
}

export function formatMarginPercent(margin: number | null): string {
  return margin === null ? "—" : `${margin.toFixed(1)}% margin`;
}
