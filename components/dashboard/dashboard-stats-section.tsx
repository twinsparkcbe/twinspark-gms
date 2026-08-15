"use client";

import { useState } from "react";
import { toast } from "sonner";

import { MONTH_ABBR } from "@/lib/format";
// From date-range-types.ts, not date-range.ts — see the comment in
// dashboard-date-range-filter.tsx for why. DashboardStats stays a type-only
// import, which is erased at compile time and safe from any barrel.
import {
  COMPARISON_LABELS,
  DATE_RANGE_PRESET_OPTIONS,
  type DateRangePreset,
} from "@/services/dashboard/date-range-types";
import type { DashboardStats } from "@/services/dashboard/stats";

import { fetchDashboardStatsAction } from "@/app/(app)/dashboard/actions";

import { DashboardDateRangeFilter } from "./dashboard-date-range-filter";
import { DashboardStatCards } from "./dashboard-stat-cards";

function formatYMDLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${d} ${MONTH_ABBR[m - 1]} ${y}`;
}

function labelForRange(preset: DateRangePreset, custom?: { fromYMD: string; toYMD: string }): string {
  if (preset === "custom" && custom) {
    return `${formatYMDLabel(custom.fromYMD)} – ${formatYMDLabel(custom.toYMD)}`;
  }
  return DATE_RANGE_PRESET_OPTIONS.find((o) => o.value === preset)?.label ?? "";
}

/**
 * Wraps the page header and stat cards with a date-range filter — the Server
 * Component page.tsx loads "Today" up front (matching this same default), and
 * this client wrapper refetches via a Server Action whenever the range changes.
 *
 * `greeting` and `todayLabel` arrive as pre-rendered strings rather than being
 * derived here: anything computed from `new Date()` during a client render is
 * a hydration mismatch (see services/dashboard/greeting.ts).
 *
 * Track Tyre Stock inside `stats` is a live snapshot regardless of the
 * selected range — only the money/count figures actually change.
 */
const DEFAULT_PRESET: DateRangePreset = "today";

export function DashboardStatsSection({
  initialStats,
  greeting,
  todayLabel,
  actionBar,
}: {
  initialStats: DashboardStats;
  greeting: string;
  todayLabel: string;
  /** Slot for the (Server Component) action bar, which sits between the header
   * row and the stat cards. Passed in rather than rendered here so this file
   * stays purely about the date-range state. */
  actionBar?: React.ReactNode;
}) {
  const [preset, setPreset] = useState<DateRangePreset>(DEFAULT_PRESET);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [stats, setStats] = useState(initialStats);
  const [rangeLabel, setRangeLabel] = useState(() => labelForRange(DEFAULT_PRESET));
  const [comparisonLabel, setComparisonLabel] = useState(COMPARISON_LABELS[DEFAULT_PRESET]);
  const [isLoading, setIsLoading] = useState(false);

  async function refetch(nextPreset: DateRangePreset, custom?: { fromYMD: string; toYMD: string }) {
    setIsLoading(true);
    const result = await fetchDashboardStatsAction(nextPreset, custom);
    setIsLoading(false);

    if (result.success) {
      setStats(result.data);
      // Labels only update on success — what's displayed always matches the
      // figures actually on screen, never a range that failed to load or that
      // the user is still mid-typing into the custom date inputs.
      setRangeLabel(labelForRange(nextPreset, custom));
      setComparisonLabel(COMPARISON_LABELS[nextPreset]);
    } else {
      toast.error(result.error);
    }
  }

  function handlePresetChange(nextPreset: DateRangePreset) {
    setPreset(nextPreset);
    // Custom needs both dates picked first — wait for the Apply button
    // instead of firing a request after every dropdown change.
    if (nextPreset !== "custom") {
      void refetch(nextPreset);
    }
  }

  function handleApplyCustom() {
    if (!customFrom || !customTo) return;
    void refetch("custom", { fromYMD: customFrom, toYMD: customTo });
  }

  function handleReset() {
    setPreset(DEFAULT_PRESET);
    setCustomFrom("");
    setCustomTo("");
    // Skips the refetch when the cards already show the default range — the
    // only thing to clear then is half-typed custom dates that were never
    // applied, so the figures on screen are already correct.
    if (preset !== DEFAULT_PRESET) {
      void refetch(DEFAULT_PRESET);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-neutral-900">{greeting}, Twinspark</h1>
          <p className="mt-0.5 text-sm text-neutral-500">{todayLabel}</p>
        </div>
        <DashboardDateRangeFilter
          preset={preset}
          customFrom={customFrom}
          customTo={customTo}
          isLoading={isLoading}
          canReset={preset !== DEFAULT_PRESET || customFrom !== "" || customTo !== ""}
          onPresetChange={handlePresetChange}
          onCustomFromChange={setCustomFrom}
          onCustomToChange={setCustomTo}
          onApplyCustom={handleApplyCustom}
          onReset={handleReset}
        />
      </div>
      {actionBar}
      <DashboardStatCards stats={stats} rangeLabel={rangeLabel} comparisonLabel={comparisonLabel} />
    </div>
  );
}
