"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

// deriveStatusCounts is imported from rules.ts directly, NOT from the
// "@/services/inventory" barrel. The barrel re-exports items.ts/brands.ts,
// which carry `import "server-only"` — pulling that into a Client Component
// is a build error, even when the thing you actually wanted is a pure
// function. rules.ts is a leaf with only type-only imports, so it's safe.
// (Same split as services/dashboard/date-range-types.ts.)
import { deriveStatusCounts } from "@/services/inventory/rules";
import type {
  BrandRow,
  InventoryItemRow,
  InventoryItemSort,
  InventoryStats,
  StockAdjustmentInput,
} from "@/services/inventory";
import type { ItemType } from "@/types/database.types";

import {
  adjustInventoryStockAction,
  exportInventoryItemsAction,
  fetchInventoryItemsAction,
  fetchInventoryStatsAction,
  fetchReorderItemsAction,
} from "@/app/(app)/inventory/actions";

import { AdjustStockDialog } from "./adjust-stock-dialog";
import { getItemTypeBadgeText, STOCK_STATUS_LABELS } from "./constants";
import { InventoryFilters } from "./inventory-filters";
import { InventoryHeader } from "./inventory-header";
import { InventoryStatusChips } from "./inventory-status-chips";
import { InventoryTable } from "./inventory-table";
import { ItemDetailDrawer } from "./item-detail-drawer";
import { ReorderStrip } from "./reorder-strip";

// itemTypes and brandIds are multi-select (match-ANY): an empty array means
// "no filter" (i.e. All). stockStatus stays single-select — it's now driven by
// the chip row rather than a dropdown.
export interface InventoryFilterState {
  search: string;
  itemTypes: ItemType[];
  brandIds: string[];
  stockStatus: "in_stock" | "low_stock" | "out_of_stock" | "all";
}

const DEFAULT_FILTERS: InventoryFilterState = {
  search: "",
  itemTypes: [],
  brandIds: [],
  stockStatus: "all",
};

const PAGE_SIZE = 20;

// Urgency, not "newest" — the owner opens this screen to find problems
// (doc/inventory-redesign-scope.md §3d).
const DEFAULT_SORT: InventoryItemSort = "urgency";

export function InventoryPageClient({
  initialItems,
  initialTotal,
  brands,
  initialStats,
  initialReorderItems,
}: {
  initialItems: InventoryItemRow[];
  initialTotal: number;
  brands: BrandRow[];
  initialStats: InventoryStats;
  initialReorderItems: InventoryItemRow[];
}) {
  const [filters, setFilters] = useState<InventoryFilterState>(DEFAULT_FILTERS);
  const [sortBy, setSortBy] = useState<InventoryItemSort>(DEFAULT_SORT);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [stats, setStats] = useState(initialStats);
  const [reorderItems, setReorderItems] = useState(initialReorderItems);

  const [adjustDialog, setAdjustDialog] = useState<{ open: boolean; item: InventoryItemRow | null }>({
    open: false,
    item: null,
  });
  const [detailItem, setDetailItem] = useState<InventoryItemRow | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  const counts = useMemo(() => deriveStatusCounts(stats), [stats]);

  // Set by handleFilterChange when the change came from the free-text search
  // box, so the effect below knows whether to debounce (typing) or fetch
  // immediately (chips, dropdown filters, pagination, reset).
  const isTextChangeRef = useRef(false);
  // The server component already loaded page 1 with default filters — skip
  // the first run of the effect below so we don't immediately re-fetch the
  // exact same data on mount.
  const hasMountedRef = useRef(false);

  const router = useRouter();
  const searchParams = useSearchParams();

  // The dashboard's Needs Attention panel deep-links here with
  // ?search=<product name>&stockStatus=<status> so a click lands pre-filtered
  // instead of on a blank Inventory list. Params are stripped right after so a
  // refresh doesn't re-apply a stale filter.
  useEffect(() => {
    const search = searchParams.get("search");
    const stockStatus = searchParams.get("stockStatus") as InventoryFilterState["stockStatus"] | null;
    if (!search && !stockStatus) return;

    setFilters((prev) => ({
      ...prev,
      search: search ?? prev.search,
      stockStatus: stockStatus ?? prev.stockStatus,
    }));
    router.replace("/inventory", { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    const result = await fetchInventoryItemsAction({
      search: filters.search || undefined,
      itemTypes: filters.itemTypes.length ? filters.itemTypes : undefined,
      brandIds: filters.brandIds.length ? filters.brandIds : undefined,
      stockStatus: filters.stockStatus === "all" ? undefined : filters.stockStatus,
      sortBy,
      page,
      pageSize: PAGE_SIZE,
    });
    setIsLoading(false);

    if (result.success) {
      setItems(result.data.items);
      setTotal(result.data.total);
    } else {
      toast.error(result.error);
    }
  }, [filters, sortBy, page]);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    // Only debounce actual typing — page changes, sort, chips and dropdown
    // filters should feel instant, not wait out a fixed 300ms on every click.
    const delay = isTextChangeRef.current ? 300 : 0;
    const handle = setTimeout(() => {
      refetch();
    }, delay);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, sortBy, page]);

  function handleFilterChange(next: Partial<InventoryFilterState>) {
    isTextChangeRef.current = Object.prototype.hasOwnProperty.call(next, "search");
    setFilters((prev) => ({ ...prev, ...next }));
    setPage(1);
  }

  function handleStatusChange(stockStatus: InventoryFilterState["stockStatus"]) {
    isTextChangeRef.current = false;
    setFilters((prev) => ({ ...prev, stockStatus }));
    setPage(1);
  }

  function handleResetFilters() {
    isTextChangeRef.current = false;
    setFilters(DEFAULT_FILTERS);
    setSortBy(DEFAULT_SORT);
    setPage(1);
  }

  function handlePageChange(nextPage: number) {
    isTextChangeRef.current = false;
    setPage(nextPage);
  }

  function handleSortChange(nextSort: InventoryItemSort) {
    isTextChangeRef.current = false;
    setSortBy(nextSort);
    setPage(1);
  }

  function handleOpenItem(item: InventoryItemRow) {
    setDetailItem(item);
    setIsDetailOpen(true);
  }

  const hasActiveFilters =
    filters.search !== "" ||
    filters.itemTypes.length > 0 ||
    filters.brandIds.length > 0 ||
    filters.stockStatus !== "all";

  // Counts, value and the reorder strip only change on real mutations, not on
  // filtering/paging — refresh them alongside the table after a write instead
  // of on every refetch().
  const refreshSummary = useCallback(async () => {
    const [statsResult, reorderResult] = await Promise.all([
      fetchInventoryStatsAction(),
      fetchReorderItemsAction(),
    ]);
    // A failure here leaves the previous summary on screen rather than
    // blanking it — the item list is the primary content and still rendered.
    if (statsResult.success) setStats(statsResult.data);
    if (reorderResult.success) setReorderItems(reorderResult.data);
  }, []);

  async function handleAdjustStock(input: StockAdjustmentInput) {
    const result = await adjustInventoryStockAction(input);
    if (result.success) {
      toast.success("Stock adjusted.");
      // Closing the drawer keeps its stock figures from showing a value that
      // the adjustment just invalidated.
      setIsDetailOpen(false);
      await Promise.all([refetch(), refreshSummary()]);
    } else {
      toast.error(result.error);
    }
    return result;
  }

  function toCsvCell(value: string | number): string {
    const str = String(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  }

  async function handleExport() {
    setIsExporting(true);
    const result = await exportInventoryItemsAction({
      search: filters.search || undefined,
      itemTypes: filters.itemTypes.length ? filters.itemTypes : undefined,
      brandIds: filters.brandIds.length ? filters.brandIds : undefined,
      stockStatus: filters.stockStatus === "all" ? undefined : filters.stockStatus,
    });
    setIsExporting(false);

    if (!result.success) {
      toast.error(result.error);
      return;
    }
    if (result.data.length === 0) {
      toast.error("No items match the current filters.");
      return;
    }

    // Price columns are deliberately excluded — Inventory is stock-monitoring
    // only now, pricing lives on Purchase batches
    // (doc/inventory-purchase-simplification-scope.md §2.2).
    const header = ["Product Name", "SKU", "Type", "Brand", "Available Qty", "Status"];
    const rows = result.data.map((item) => [
      item.productName,
      item.skuCode,
      getItemTypeBadgeText(item),
      item.brandName ?? "",
      item.availableQuantity,
      STOCK_STATUS_LABELS[item.stockStatus],
    ]);
    const csv = [header, ...rows].map((row) => row.map(toCsvCell).join(",")).join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `inventory-export-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${result.data.length} item${result.data.length === 1 ? "" : "s"}.`);
  }

  return (
    <div className="space-y-4">
      <InventoryHeader
        counts={counts}
        inventoryValueCost={stats.inventoryValueCost}
        onExport={handleExport}
        isExporting={isExporting}
      />

      <InventoryFilters
        filters={filters}
        brands={brands}
        sortBy={sortBy}
        onChange={handleFilterChange}
        onSortChange={handleSortChange}
        onReset={handleResetFilters}
        canReset={hasActiveFilters || sortBy !== DEFAULT_SORT}
      />

      <InventoryStatusChips counts={counts} value={filters.stockStatus} onChange={handleStatusChange} />

      <ReorderStrip items={reorderItems} />

      <InventoryTable
        items={items}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        isLoading={isLoading}
        hasActiveFilters={hasActiveFilters}
        onPageChange={handlePageChange}
        onOpenItem={handleOpenItem}
      />

      <ItemDetailDrawer
        item={detailItem}
        open={isDetailOpen}
        onOpenChange={setIsDetailOpen}
        onAdjustStock={(item) => setAdjustDialog({ open: true, item })}
      />

      <AdjustStockDialog
        open={adjustDialog.open}
        onOpenChange={(open) => setAdjustDialog((prev) => ({ ...prev, open }))}
        item={adjustDialog.item}
        onSubmit={handleAdjustStock}
      />
    </div>
  );
}
