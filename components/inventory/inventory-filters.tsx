"use client";

import { RotateCcw, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MultiSelect } from "@/components/ui/multi-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BrandRow, InventoryItemSort } from "@/services/inventory";
import type { ItemType } from "@/types/database.types";

import { ITEM_TYPE_OPTIONS } from "./constants";
import type { InventoryFilterState } from "./inventory-page-client";

const SORT_OPTIONS: { value: InventoryItemSort; label: string }[] = [
  { value: "urgency", label: "Needs attention first" },
  { value: "name", label: "Name (A-Z)" },
  { value: "stock", label: "Stock (low to high)" },
  { value: "newest", label: "Newest" },
];

/**
 * Search, type, brand and sort. The stock-status dropdown that used to live
 * here is gone — status is now the chip row above, which does the same
 * filtering while also showing the counts
 * (doc/inventory-redesign-scope.md §3b). Export moved into the page header.
 */
export function InventoryFilters({
  filters,
  brands,
  sortBy,
  onChange,
  onSortChange,
  onReset,
  canReset,
}: {
  filters: InventoryFilterState;
  brands: BrandRow[];
  sortBy: InventoryItemSort;
  onChange: (next: Partial<InventoryFilterState>) => void;
  onSortChange: (next: InventoryItemSort) => void;
  onReset: () => void;
  canReset: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative min-w-0 flex-1 sm:min-w-[220px]">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-neutral-400" />
        <Input
          placeholder="Search by product name or SKU..."
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

      <Select value={sortBy} onValueChange={(value) => onSortChange(value as InventoryItemSort)}>
        <SelectTrigger size="sm" className="w-full rounded-[10px] sm:w-[190px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              Sort: {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Hidden until there's actually something to clear, so it isn't a
          permanently dead button. */}
      {canReset && (
        <Button variant="secondary" size="sm" className="shrink-0 rounded-[10px]" onClick={onReset}>
          <RotateCcw className="size-4" />
          Reset
        </Button>
      )}
    </div>
  );
}
