import { IndianRupee, TrendingDown, TrendingUp, Wrench } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatINR } from "@/lib/format";
import { computeMarginPercent, formatMarginPercent } from "@/services/dashboard/delta";
import type { DashboardStats } from "@/services/dashboard/stats";

import { MetricDelta, type DeltaPolarity } from "./metric-delta";

/**
 * Two tiers, not one flat grid of six equal cards. The money the owner
 * actually judges the month on (Sales, Service, Profit) gets hero treatment;
 * the supporting figures compress into a single bordered strip so they stop
 * competing for the same attention (doc/dashboard-redesign-scope.md §2).
 */

function HeroCard({
  icon: Icon,
  iconClassName,
  label,
  hint,
  value,
  valueClassName,
  aside,
  current,
  previous,
  comparisonLabel,
  polarity,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconClassName: string;
  label: string;
  hint?: string;
  value: string;
  valueClassName?: string;
  /** Secondary figure shown beside the delta, e.g. the profit margin. */
  aside?: string;
  current: number;
  previous: number;
  comparisonLabel: string;
  polarity?: DeltaPolarity;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", iconClassName)}>
          <Icon className="size-4" />
        </div>
        <p className="min-w-0 truncate text-sm font-medium text-neutral-500">
          {label}
          {hint && <span className="ml-1 text-neutral-400">· {hint}</span>}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className={cn("truncate text-3xl font-bold tracking-tight text-neutral-900", valueClassName)}>{value}</p>
        <MetricDelta current={current} previous={previous} polarity={polarity} />
        {aside && <span className="text-xs font-medium text-neutral-500">{aside}</span>}
      </div>

      <p className="mt-1 truncate text-xs text-neutral-400">
        vs {formatINR(previous)} {comparisonLabel}
      </p>
    </div>
  );
}

function StripCell({
  label,
  value,
  valueClassName,
  delta,
}: {
  label: string;
  value: string;
  valueClassName?: string;
  delta?: React.ReactNode;
}) {
  return (
    <div className="bg-white p-4">
      <p className="truncate text-xs font-medium text-neutral-500">{label}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <p className={cn("truncate text-xl font-bold tracking-tight text-neutral-900", valueClassName)}>{value}</p>
        {delta}
      </div>
    </div>
  );
}

// "—" for a position whose active item is missing (doc/dashboard-scope.md
// §6) rather than showing 0, which would misleadingly read as "zero stock"
// instead of "nothing to report."
function stockValue(quantity: number | null): string {
  return quantity === null ? "—" : quantity.toLocaleString("en-IN");
}

export function DashboardStatCards({
  stats,
  rangeLabel = "This Month",
  comparisonLabel = "last month",
}: {
  stats: DashboardStats;
  /** Human-readable label for the selected date range (e.g. "This Month",
   * "1 Jul – 15 Jul 2026") — the period-based figures show it so it's always
   * clear what they're summarizing. Track Tyre Stock is a live snapshot and
   * never carries this label. */
  rangeLabel?: string;
  /** Human-readable label for the comparison window, e.g. "last month". */
  comparisonLabel?: string;
}) {
  const isProfit = stats.profit >= 0;
  const totalRevenue = stats.salesAmount + stats.serviceAmount;
  const margin = computeMarginPercent(stats.profit, totalRevenue);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <HeroCard
          icon={IndianRupee}
          iconClassName="bg-success-bg text-success"
          label={`Sales Amount (${rangeLabel})`}
          value={formatINR(stats.salesAmount)}
          current={stats.salesAmount}
          previous={stats.previous.salesAmount}
          comparisonLabel={comparisonLabel}
        />
        <HeroCard
          icon={Wrench}
          iconClassName="bg-success-bg text-success"
          label={`Service Amount (${rangeLabel})`}
          hint="completed jobs"
          value={formatINR(stats.serviceAmount)}
          current={stats.serviceAmount}
          previous={stats.previous.serviceAmount}
          comparisonLabel={comparisonLabel}
        />
        <HeroCard
          icon={isProfit ? TrendingUp : TrendingDown}
          iconClassName={isProfit ? "bg-success-bg text-success" : "bg-danger-bg text-danger"}
          label={`Profit (${rangeLabel})`}
          // Spelled out because Profit here is NOT sales minus purchases —
          // without this the owner reads ₹5,400 sales against ₹27,000
          // purchases and expects a loss.
          hint="sales + service − COGS"
          value={formatINR(stats.profit)}
          valueClassName={isProfit ? undefined : "text-danger"}
          aside={margin === null ? undefined : formatMarginPercent(margin)}
          current={stats.profit}
          previous={stats.previous.profit}
          comparisonLabel={comparisonLabel}
        />
      </div>

      {/* Uneven column widths at the lg breakpoint (all 6 cells in one row):
          the money cells (Purchases/Cash/UPI) need enough room for a ₹ value
          plus a delta arrow without truncating, while Track Tyre's plain
          stock counts (2-3 digits) don't need nearly as much — an equal
          6-way split was clipping "₹1,58,600" mid-number. */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-neutral-200 bg-neutral-200 shadow-sm md:grid-cols-3 lg:grid-cols-[1.3fr_0.7fr_1.1fr_1.1fr_0.6fr_0.6fr]">
        <StripCell
          label={`Purchases (${rangeLabel})`}
          value={formatINR(stats.purchaseAmount)}
          delta={
            <MetricDelta
              current={stats.purchaseAmount}
              previous={stats.previous.purchaseAmount}
              polarity="neutral"
            />
          }
        />
        <StripCell label={`Invoices (${rangeLabel})`} value={stats.totalSalesCount.toLocaleString("en-IN")} />
        {/* Live snapshot of what actually came in as cash/UPI this range
            (getCollectionsReport, services/reports/collections.ts) — no
            previous-period delta, matching Invoices/Track Tyre below rather
            than the money cards above (doc/dashboard-redesign-scope.md
            addendum). */}
        <StripCell label={`Cash Collected (${rangeLabel})`} value={formatINR(stats.cashCollected)} />
        <StripCell label={`UPI Collected (${rangeLabel})`} value={formatINR(stats.upiCollected)} />
        <StripCell label="Track Tyre · Front" value={stockValue(stats.trackTyreStock.front)} />
        <StripCell label="Track Tyre · Back" value={stockValue(stats.trackTyreStock.back)} />
      </div>
    </div>
  );
}
