"use client";

import { RotateCcw, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MultiSelect } from "@/components/ui/multi-select";
import { ITEM_TYPE_OPTIONS } from "@/components/inventory/constants";
import type { BrandRow } from "@/services/inventory";
import type { ItemType } from "@/types/database.types";

import type { PurchaseFilterState } from "./purchase-page-client";

export function PurchaseFilters({
  filters,
  brands,
  onChange,
  onReset,
}: {
  filters: PurchaseFilterState;
  brands: BrandRow[];
  onChange: (next: Partial<PurchaseFilterState>) => void;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-neutral-200 bg-white p-3 shadow-sm sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative min-w-0 flex-1 sm:min-w-[220px]">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-neutral-400" />
        <Input
          placeholder="Search by item name or SKU..."
          className="h-9 rounded-[10px] pl-9 text-sm"
          value={filters.search}
          onChange={(e) => onChange({ search: e.target.value })}
        />
      </div>

      <div className="w-full sm:w-[170px]">
        <MultiSelect
          options={ITEM_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          values={filters.itemTypes}
          onChange={(values) => onChange({ itemTypes: values as ItemType[] })}
          placeholder="All Types"
          searchPlaceholder="Search types..."
          emptyText="No matching type."
        />
      </div>

      <div className="w-full sm:w-[150px]">
        <MultiSelect
          options={brands.map((b) => ({ value: b.id, label: b.name }))}
          values={filters.brandIds}
          onChange={(values) => onChange({ brandIds: values })}
          placeholder="All Brands"
          searchPlaceholder="Search brands..."
          emptyText="No matching brand."
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

      <div className="flex shrink-0 gap-2">
        <Button variant="secondary" size="sm" className="rounded-[10px]" onClick={onReset}>
          <RotateCcw className="size-4" />
          Reset
        </Button>
      </div>
    </div>
  );
}
