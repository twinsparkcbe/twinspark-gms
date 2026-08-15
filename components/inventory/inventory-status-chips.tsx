"use client";

import { cn } from "@/lib/utils";
import type { StatusCounts } from "@/services/inventory";

import type { InventoryFilterState } from "./inventory-page-client";

type ChipValue = InventoryFilterState["stockStatus"];

/**
 * The status filter and the status counts, as one control
 * (doc/inventory-redesign-scope.md §3b). This replaces the old status
 * dropdown outright — two controls doing one job is how a filter bar becomes
 * confusing, and the counts make the chips self-explanatory in a way a
 * dropdown label never was.
 *
 * Low/Out keep their tint while inactive so a problem is visible before any
 * interaction, but drop to plain neutral at zero — an all-healthy catalog
 * shouldn't show a red chip.
 */
const CHIP_BASE =
  "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:outline-hidden";

function toneClass(tone: "neutral" | "warning" | "danger", isActive: boolean, isEmpty: boolean): string {
  if (isActive) {
    if (tone === "danger") return "border-danger bg-danger text-white";
    if (tone === "warning") return "border-warning bg-warning text-white";
    return "border-neutral-900 bg-neutral-900 text-white";
  }
  if (isEmpty || tone === "neutral") return "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50";
  if (tone === "danger") return "border-danger/30 bg-danger-bg text-danger hover:bg-danger/15";
  return "border-warning/30 bg-warning/10 text-warning hover:bg-warning/20";
}

export function InventoryStatusChips({
  counts,
  value,
  onChange,
}: {
  counts: StatusCounts;
  value: ChipValue;
  onChange: (next: ChipValue) => void;
}) {
  const chips: { value: ChipValue; label: string; count: number; tone: "neutral" | "warning" | "danger" }[] = [
    { value: "all", label: "All", count: counts.all, tone: "neutral" },
    { value: "in_stock", label: "In stock", count: counts.inStock, tone: "neutral" },
    { value: "low_stock", label: "Low", count: counts.lowStock, tone: "warning" },
    { value: "out_of_stock", label: "Out of stock", count: counts.outOfStock, tone: "danger" },
  ];

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by stock status">
      {chips.map((chip) => {
        const isActive = value === chip.value;
        return (
          <button
            key={chip.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(chip.value)}
            className={cn(CHIP_BASE, toneClass(chip.tone, isActive, chip.count === 0))}
          >
            {chip.label}{" "}
            <span className={cn("font-normal", !isActive && "opacity-70")}>{chip.count.toLocaleString("en-IN")}</span>
          </button>
        );
      })}
    </div>
  );
}
