"use client";

import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * From/To date pair used by both attendance reports.
 *
 * Deliberately not the shared DashboardDateRangeFilter preset control: the
 * attendance reports are always read as calendar periods ("August", "1st to
 * the 18th"), and reusing the dashboard's preset vocabulary would pull this
 * standalone module into services/dashboard for no benefit.
 */
export function AttendanceDateRangeFilter({
  from,
  to,
  isLoading,
  canReset,
  error,
  onFromChange,
  onToChange,
  onApply,
  onReset,
  children,
}: {
  from: string;
  to: string;
  isLoading: boolean;
  canReset: boolean;
  error?: string | null;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onApply: () => void;
  onReset: () => void;
  /** Extra filter controls (employee, role) rendered inline before the buttons. */
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-[14px] border border-neutral-200 bg-white p-3 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        {children}

        <div className="space-y-1.5">
          <Label htmlFor="attendance-from" className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
            From
          </Label>
          <Input
            id="attendance-from"
            type="date"
            value={from}
            disabled={isLoading}
            onChange={(e) => onFromChange(e.target.value)}
            className="h-9 w-[160px] rounded-[10px] text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="attendance-to" className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
            To
          </Label>
          <Input
            id="attendance-to"
            type="date"
            value={to}
            disabled={isLoading}
            aria-invalid={Boolean(error) || undefined}
            onChange={(e) => onToChange(e.target.value)}
            className="h-9 w-[160px] rounded-[10px] text-sm"
          />
        </div>

        <div className="flex gap-2">
          <Button type="button" size="sm" className="rounded-[10px]" onClick={onApply} disabled={isLoading}>
            {isLoading ? "Loading..." : "Generate Report"}
          </Button>
          {canReset && (
            <Button type="button" variant="secondary" size="sm" className="rounded-[10px]" onClick={onReset} disabled={isLoading}>
              <RotateCcw className="size-4" />
              Reset
            </Button>
          )}
        </div>
      </div>

      {error && <p className="text-sm font-medium text-danger">{error}</p>}
    </div>
  );
}
