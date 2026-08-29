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
  title,
}: {
  label: string;
  value: string;
  valueClassName?: string;
  delta?: React.ReactNode;
  /** Hover text. Used for detail that would otherwise need a second line —
   * every cell in this strip must stay exactly two lines tall (label, then
   * value), because one taller cell pushes the whole row down and leaves the
   * other six with dead space under their values. */
  title?: string;
}) {
  return (
    <div className="bg-white p-4" title={title}>
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
  // Online is part of the shop's revenue for the margin calculation — the
  // same three channels Profit is built from.
  const totalRevenue = stats.salesAmount + stats.serviceAmount + stats.onlineAmount;
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
          hint="sales + service + online − COGS"
          value={formatINR(stats.profit)}
          valueClassName={isProfit ? undefined : "text-danger"}
          aside={margin === null ? undefined : formatMarginPercent(margin)}
          current={stats.profit}
          previous={stats.previous.profit}
          comparisonLabel={comparisonLabel}
        />
      </div>

      {/* Uneven column widths at the lg breakpoint (all 7 cells in one row):
          the money cells (Purchases/Online/Cash/UPI) need enough room for a ₹
          value plus a delta arrow without truncating, while Track Tyre's plain
          stock counts (2-3 digits) don't need nearly as much — an equal
          split was clipping "₹1,58,600" mid-number. */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-neutral-200 bg-neutral-200 shadow-sm md:grid-cols-3 lg:grid-cols-[1.15fr_1.15fr_0.65fr_1fr_1fr_0.55fr_0.55fr] [&>*:last-child]:col-span-2 md:[&>*:last-child]:col-span-3 lg:[&>*:last-child]:col-span-1">
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
        {/* The online channel's own figure, never folded into Sales Amount —
            "Sales" means the Sales module on every screen, so that card still
            reconciles against the Sales Report
            (doc/online-orders-revenue-scope.md §2). Counts orders DISPATCHED
            in the range: the moment the tyres leave, which is also when the
            stock movement and its cost land. */}
        <StripCell
          label={`Online Orders (${rangeLabel})`}
          value={formatINR(stats.onlineAmount)}
          title={`${stats.onlineOrderCount.toLocaleString("en-IN")} order${stats.onlineOrderCount === 1 ? "" : "s"} dispatched`}
          delta={<MetricDelta current={stats.onlineAmount} previous={stats.previous.onlineAmount} />}
        />
        {/* Sales-module bills only — the online count sits on the card above
            rather than being added in here, so this still matches the number
            of rows on the Sales page. */}
        <StripCell label={`Invoices (${rangeLabel})`} value={stats.totalSalesCount.toLocaleString("en-IN")} />
        {/* Live snapshot of what actually came in as cash/UPI this range
            (getCollectionsReport, services/reports/collections.ts) — no
            previous-period delta, matching Invoices/Track Tyre below rather
            than the money cards above (doc/dashboard-redesign-scope.md
            addendum). UPI now includes dispatched online orders: the customer
            always pays through the QR before submitting, so there is no cash
            case for that channel. */}
        <StripCell label={`Cash Collected (${rangeLabel})`} value={formatINR(stats.cashCollected)} />
        <StripCell label={`UPI Collected (${rangeLabel})`} value={formatINR(stats.upiCollected)} />
        <StripCell label="Track Tyre · Front" value={stockValue(stats.trackTyreStock.front)} />
        <StripCell label="Track Tyre · Back" value={stockValue(stats.trackTyreStock.back)} />
      </div>
    </div>
  );
}
