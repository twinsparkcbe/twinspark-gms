"use client";

import { useState } from "react";
import { toast } from "sonner";

import { MONTH_ABBR } from "@/lib/format";
import { DATE_RANGE_PRESET_OPTIONS, type DateRangePreset } from "@/services/dashboard/date-range-types";

export type ReportActionResult<T> = { success: true; data: T } | { success: false; error: string };

function formatYMDLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${d} ${MONTH_ABBR[m - 1]} ${y}`;
}

export function labelForRange(preset: DateRangePreset, custom?: { fromYMD: string; toYMD: string }): string {
  if (preset === "custom" && custom) {
    return `${formatYMDLabel(custom.fromYMD)} – ${formatYMDLabel(custom.toYMD)}`;
  }
  return DATE_RANGE_PRESET_OPTIONS.find((o) => o.value === preset)?.label ?? "";
}

/**
 * Shared date-range refetch state for every Reports page that filters by a
 * period (Purchase/Sales/Service/Revenue/Profit/Online Orders — the two new
 * threshold-based reports, Ageing Stock and Customer Follow-Up, don't use
 * this). Same shape as Dashboard's `DashboardStatsSection` wiring
 * (`components/dashboard/dashboard-stats-section.tsx`), pulled out into one
 * hook instead of re-implementing the same preset/custom/loading state six
 * times across Reports pages.
 */
const DEFAULT_PRESET: DateRangePreset = "this_month";

export function useReportDateRange<T>(
  initialData: T,
  fetcher: (preset: DateRangePreset, custom?: { fromYMD: string; toYMD: string }) => Promise<ReportActionResult<T>>
) {
  const [preset, setPreset] = useState<DateRangePreset>(DEFAULT_PRESET);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [data, setData] = useState(initialData);
  const [rangeLabel, setRangeLabel] = useState(() => labelForRange(DEFAULT_PRESET));
  const [isLoading, setIsLoading] = useState(false);

  async function refetch(nextPreset: DateRangePreset, custom?: { fromYMD: string; toYMD: string }) {
    setIsLoading(true);
    const result = await fetcher(nextPreset, custom);
    setIsLoading(false);

    if (result.success) {
      setData(result.data);
      // Only updates on success — the label always matches what's actually
      // on screen, never a range that failed to load.
      setRangeLabel(labelForRange(nextPreset, custom));
    } else {
      toast.error(result.error);
    }
  }

  function handlePresetChange(nextPreset: DateRangePreset) {
    setPreset(nextPreset);
    if (nextPreset !== "custom") void refetch(nextPreset);
  }

  function handleApplyCustom() {
    if (!customFrom || !customTo) return;
    void refetch("custom", { fromYMD: customFrom, toYMD: customTo });
  }

  function handleReset() {
    setPreset(DEFAULT_PRESET);
    setCustomFrom("");
    setCustomTo("");
    // Already on the default range means the figures on screen are correct —
    // the only thing being cleared is unapplied custom dates, so no refetch.
    if (preset !== DEFAULT_PRESET) {
      void refetch(DEFAULT_PRESET);
    }
  }

  return {
    preset,
    customFrom,
    customTo,
    data,
    rangeLabel,
    isLoading,
    canReset: preset !== DEFAULT_PRESET || customFrom !== "" || customTo !== "",
    setCustomFrom,
    setCustomTo,
    handlePresetChange,
    handleApplyCustom,
    handleReset,
  };
}
