"use client";

import { RotateCcw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UNASSIGNED_SOLD_BY } from "@/services/sales/schemas";
import type { StaffOption } from "@/services/users";

import type { SalesFilterState } from "./sales-page-client";

export function SalesFilters({
  filters,
  onChange,
  onReset,
  salespeople,
}: {
  filters: SalesFilterState;
  onChange: (next: Partial<SalesFilterState>) => void;
  onReset: () => void;
  /** Active Admins + Sales Persons — mirrors the "Sold by" picker on the form
   * (doc/sales-edit-void-scope.md §2), so the two never list different people. */
  salespeople: StaffOption[];
}) {
  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-neutral-200 bg-white p-3 shadow-sm sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative min-w-0 flex-1 sm:min-w-[220px]">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-neutral-400" />
        <Input
          placeholder="Search by customer, mobile, or invoice #..."
          className="h-9 rounded-[10px] pl-9 text-sm"
          value={filters.search}
          onChange={(e) => onChange({ search: e.target.value })}
        />
      </div>

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

      <Select
        value={filters.soldById || "ALL"}
        onValueChange={(v) => onChange({ soldById: v === "ALL" ? "" : v })}
      >
        <SelectTrigger size="sm" className="w-full rounded-[10px] sm:w-48">
          <SelectValue placeholder="Sold by" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All sold by</SelectItem>
          <SelectItem value={UNASSIGNED_SOLD_BY}>Unassigned</SelectItem>
          {salespeople.map((person) => (
            <SelectItem key={person.id} value={person.id}>
              {person.fullName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex shrink-0 gap-2">
        <Button variant="secondary" size="sm" className="rounded-[10px]" onClick={onReset}>
          <RotateCcw className="size-4" />
          Reset
        </Button>
      </div>
    </div>
  );
}
