"use client";

import { RotateCcw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
// Imported directly from the leaf schemas module (not the "@/services/
// online-orders" barrel) — this is a Client Component, and the barrel also
// re-exports orders.ts, which is server-only (`import "server-only"`).
// Mirrors the same pattern already used by BrandCombobox/item-picker-combobox
// on the Purchases side.
import { ONLINE_ORDER_STATUS_VALUES } from "@/services/online-orders/schemas";
import type { OnlineOrderStatus } from "@/types/database.types";

import type { OnlineOrderFilterState } from "./orders-page-client";

const STATUS_OPTIONS: { value: OnlineOrderStatus; label: string }[] = ONLINE_ORDER_STATUS_VALUES.map((value) => ({
  value,
  label:
    value === "SUBMITTED"
      ? "Awaiting Verification"
      : value === "PAYMENT_VERIFIED"
        ? "Payment Verified"
        : value === "APPROVED"
          ? "Approved"
          : value === "DISPATCHED"
            ? "Dispatched"
            : "Rejected",
}));

export function OnlineOrdersFilters({
  filters,
  onChange,
  onReset,
}: {
  filters: OnlineOrderFilterState;
  onChange: (next: Partial<OnlineOrderFilterState>) => void;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-neutral-200 bg-white p-3 shadow-sm sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative min-w-0 flex-1 sm:min-w-[220px]">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-neutral-400" />
        <Input
          placeholder="Search by customer name or mobile..."
          className="h-9 rounded-[10px] pl-9 text-sm"
          value={filters.search}
          onChange={(e) => onChange({ search: e.target.value })}
        />
      </div>

      <div className="w-full sm:w-[210px]">
        <MultiSelect
          options={STATUS_OPTIONS}
          values={filters.statuses}
          onChange={(values) => onChange({ statuses: values as OnlineOrderStatus[] })}
          placeholder="All Statuses"
          searchPlaceholder="Search statuses..."
          emptyText="No matching status."
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
