"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TrendGranularity, TrendPoint } from "@/services/dashboard";

const GRANULARITY_TABS: { value: TrendGranularity; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

const PERIOD_NOUN: Record<TrendGranularity, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: TrendPoint }[] }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-[10px] border border-neutral-200 bg-white px-3 py-2 shadow-md">
      <p className="text-xs font-medium text-neutral-500">{point.fullLabel}</p>
      <p className="text-sm font-bold text-neutral-900">{point.unitsSold} tyres sold</p>
    </div>
  );
}

/**
 * Pre-fetched server-side for all three granularities (doc/dashboard-scope.md
 * addendum) — the dataset is tiny (14+8+6 points), so switching the tab just
 * swaps which array renders, no client round-trip needed.
 *
 * Two readability changes over the original (doc/dashboard-redesign-scope.md
 * §3h): a dashed average line, so a single tall bar reads as "well above
 * normal" instead of just "a bar"; and `minPointSize` on the bars, so an empty
 * day renders a thin stub rather than a gap — a gap is ambiguous between "no
 * sales" and "no data".
 */
export function TrackTyreSalesChart({
  daily,
  weekly,
  monthly,
}: {
  daily: TrendPoint[];
  weekly: TrendPoint[];
  monthly: TrendPoint[];
}) {
  const [granularity, setGranularity] = useState<TrendGranularity>("daily");
  const data = granularity === "daily" ? daily : granularity === "weekly" ? weekly : monthly;

  const { total, average, hasActivity } = useMemo(() => {
    const sum = data.reduce((acc, point) => acc + point.unitsSold, 0);
    return {
      total: sum,
      average: data.length === 0 ? 0 : Math.round((sum / data.length) * 10) / 10,
      hasActivity: sum > 0,
    };
  }, [data]);

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-neutral-900">Track Tyre sales</h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            Units sold — in-store Sales + Dispatched Online Orders, Front &amp; Back combined.
          </p>
          {hasActivity && (
            <p className="mt-0.5 text-xs text-neutral-400">
              {total.toLocaleString("en-IN")} in this period · {PERIOD_NOUN[granularity].toLowerCase()} average{" "}
              {average.toLocaleString("en-IN")}
            </p>
          )}
        </div>
        <Tabs value={granularity} onValueChange={(v) => setGranularity(v as TrendGranularity)}>
          <TabsList>
            {GRANULARITY_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="mt-4 h-[300px]">
        {hasActivity ? (
          <ResponsiveContainer width="100%" height="100%">
            {/* Extra right margin so the average line's label has room and
                doesn't clip against the plot edge. */}
            <BarChart data={data} margin={{ top: 8, right: 44, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-neutral-100)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "var(--color-neutral-500)" }}
                tickLine={false}
                axisLine={{ stroke: "var(--color-neutral-200)" }}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: "var(--color-neutral-500)" }}
                tickLine={false}
                axisLine={false}
                width={32}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--color-neutral-50)" }} />
              <ReferenceLine
                y={average}
                stroke="var(--color-warning)"
                strokeDasharray="4 4"
                label={{
                  value: `avg ${average}`,
                  position: "right",
                  fill: "var(--color-warning)",
                  fontSize: 10,
                }}
              />
              <Bar
                dataKey="unitsSold"
                fill="var(--color-brand-red)"
                radius={[4, 4, 0, 0]}
                maxBarSize={40}
                minPointSize={2}
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-neutral-500">
            No Track Tyre sales in this period yet.
          </div>
        )}
      </div>
    </div>
  );
}
