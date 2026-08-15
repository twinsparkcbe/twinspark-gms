"use client";

import { Loader2, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
// From date-range-types.ts specifically, not date-range.ts or the barrel —
// both of those carry "import server-only", which breaks a Client
// Component even when importing what looks like a plain constant.
import { DATE_RANGE_PRESET_OPTIONS, type DateRangePreset } from "@/services/dashboard/date-range-types";

export function DashboardDateRangeFilter({
  preset,
  customFrom,
  customTo,
  isLoading,
  canReset,
  onPresetChange,
  onCustomFromChange,
  onCustomToChange,
  onApplyCustom,
  onReset,
}: {
  preset: DateRangePreset;
  customFrom: string;
  customTo: string;
  isLoading: boolean;
  canReset: boolean;
  onPresetChange: (preset: DateRangePreset) => void;
  onCustomFromChange: (value: string) => void;
  onCustomToChange: (value: string) => void;
  onApplyCustom: () => void;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={preset} onValueChange={(v) => onPresetChange(v as DateRangePreset)}>
        <SelectTrigger size="sm" className="w-[160px] rounded-[10px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DATE_RANGE_PRESET_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {preset === "custom" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Input
            type="date"
            aria-label="From date"
            className="h-9 w-[150px] rounded-[10px] text-sm"
            value={customFrom}
            onChange={(e) => onCustomFromChange(e.target.value)}
          />
          <span className="text-xs text-neutral-400">to</span>
          <Input
            type="date"
            aria-label="To date"
            className="h-9 w-[150px] rounded-[10px] text-sm"
            value={customTo}
            onChange={(e) => onCustomToChange(e.target.value)}
          />
          <Button
            type="button"
            size="sm"
            className="rounded-[10px]"
            disabled={!customFrom || !customTo || isLoading}
            onClick={onApplyCustom}
          >
            Apply
          </Button>
        </div>
      )}

      {/* Hidden on the default range so it isn't a permanently dead button —
          it only appears once there's actually something to clear. */}
      {canReset && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="rounded-[10px]"
          disabled={isLoading}
          onClick={onReset}
        >
          <RotateCcw className="size-4" />
          Reset
        </Button>
      )}

      {isLoading && <Loader2 className="size-4 shrink-0 animate-spin text-neutral-400" aria-label="Loading" />}
    </div>
  );
}
