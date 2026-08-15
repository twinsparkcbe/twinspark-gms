"use client";

import { RotateCcw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import type { MechanicOption } from "@/services/users";

import { MechanicSelect } from "./mechanic-select";
import { JOB_STATUS_LABELS } from "./status-badge";

import type { ServiceFilterState } from "./service-filter-state";

const STATUS_OPTIONS = ["DRAFT", "IN_PROGRESS", "READY_FOR_DELIVERY", "COMPLETED", "CANCELLED"] as const;

export function ServiceFilters({
  filters,
  onChange,
  onReset,
  mechanics,
}: {
  filters: ServiceFilterState;
  onChange: (next: Partial<ServiceFilterState>) => void;
  onReset: () => void;
  mechanics: MechanicOption[];
}) {
  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-neutral-200 bg-white p-3 shadow-sm sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative min-w-0 flex-1 sm:min-w-[240px]">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-neutral-400" />
        <Input
          placeholder="Search by vehicle, customer, mobile, job #, or invoice #..."
          className="h-9 rounded-[10px] pl-9 text-sm"
          value={filters.search}
          onChange={(e) => onChange({ search: e.target.value })}
        />
      </div>

      <MechanicSelect
        value={filters.assignedMechanicId || "ALL"}
        onChange={(v) => onChange({ assignedMechanicId: v === "ALL" ? "" : v })}
        mechanics={mechanics}
        allOption="All mechanics"
        className="w-full rounded-[10px] sm:w-48"
      />

      <Select value={filters.status || "ALL"} onValueChange={(v) => onChange({ status: v === "ALL" ? "" : v })}>
        <SelectTrigger size="sm" className="w-full rounded-[10px] sm:w-48">
          <SelectValue placeholder="All statuses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All statuses</SelectItem>
          {STATUS_OPTIONS.map((s) => (
            <SelectItem key={s} value={s}>
              {JOB_STATUS_LABELS[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex w-full items-center gap-1.5 sm:w-auto">
        <Input
          type="date"
          aria-label="From date"
          className="h-9 w-full rounded-[10px] text-sm sm:w-[140px]"
          value={filters.dateFrom}
          onChange={(e) => onChange({ dateFrom: e.target.value })}
        />
        <span className="text-xs text-neutral-400">to</span>
        <Input
          type="date"
          aria-label="To date"
          className="h-9 w-full rounded-[10px] text-sm sm:w-[140px]"
          value={filters.dateTo}
          onChange={(e) => onChange({ dateTo: e.target.value })}
        />
      </div>

      <div className="flex shrink-0 gap-2">
        <Button variant="secondary" size="sm" className="rounded-[10px]" onClick={onReset}>
          <RotateCcw className="size-4" />
          Reset
        </Button>
      </div>
    </div>
  );
}
