"use client";

import { ChevronLeft, ChevronRight, ImageOff, Package, PackageSearch } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { InventoryItemRow, StockStatus } from "@/services/inventory";

import { formatStockRatio, getItemTypeBadgeText, ITEM_TYPE_BADGE_CLASS, stockRowTone } from "./constants";

// Product | Type | Brand | Stock | chevron.
//
// The Status column is gone: status is carried by the row tint and the
// coloured stock figure instead, which frees the width and — more importantly
// — makes urgency readable without scanning one specific column
// (doc/inventory-redesign-scope.md §3e).
const ROW_GRID_CLASS = "grid grid-cols-[minmax(200px,2.1fr)_120px_130px_140px_32px] gap-3";

const STOCK_TEXT_CLASS: Record<StockStatus, string> = {
  in_stock: "text-success",
  low_stock: "text-warning",
  out_of_stock: "text-danger",
};

const STOCK_PROGRESS_CLASS: Record<StockStatus, string> = {
  in_stock: "bg-success",
  low_stock: "bg-warning",
  out_of_stock: "bg-danger",
};

const ROW_TONE_CLASS = {
  danger: "border-danger/20 bg-danger-bg hover:bg-danger/15",
  warning: "border-warning/20 bg-warning/10 hover:bg-warning/20",
} as const;

function stockProgressPercent(item: InventoryItemRow): number {
  // No "max stock" field exists in the data model — use 2x the low-stock
  // threshold as a "healthy" reference point so the bar communicates
  // "how far above the reorder line" rather than an arbitrary absolute cap.
  const reference = Math.max(item.lowStockThreshold * 2, item.availableQuantity, 1);
  return Math.min(100, Math.round((item.availableQuantity / reference) * 100));
}

/** Page numbers with ellipsis: 1 … current-1, current, current+1 … last. */
function getPageNumbers(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages = new Set([1, total, current - 1, current, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);

  const result: (number | "ellipsis")[] = [];
  sorted.forEach((page, i) => {
    if (i > 0 && page - sorted[i - 1] > 1) result.push("ellipsis");
    result.push(page);
  });
  return result;
}

function ProductThumbnail({ item }: { item: InventoryItemRow }) {
  if (item.imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- dynamic Supabase Storage URL
      <img
        src={item.imageUrl}
        alt=""
        className="size-8 shrink-0 rounded-lg border border-neutral-200 object-cover"
      />
    );
  }
  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50">
      <ImageOff className="size-3.5 text-neutral-300" />
    </div>
  );
}

export function InventoryTable({
  items,
  total,
  page,
  pageSize,
  isLoading,
  hasActiveFilters,
  onPageChange,
  onOpenItem,
}: {
  items: InventoryItemRow[];
  total: number;
  page: number;
  pageSize: number;
  isLoading: boolean;
  hasActiveFilters: boolean;
  onPageChange: (page: number) => void;
  /** The whole row is the target — it opens the detail drawer, which is where
   * Adjust Stock now lives (doc/inventory-redesign-scope.md §3f). */
  onOpenItem: (item: InventoryItemRow) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);
  const pageNumbers = getPageNumbers(page, totalPages);

  // Only replace the list with skeleton rows on the true first load (no data
  // yet). Once we have items, a page/filter change re-fetches in the
  // background — keep the current rows on screen (dimmed) instead of
  // blanking the list, so pagination doesn't look like it emptied out.
  const showSkeleton = isLoading && items.length === 0;
  const showEmpty = !showSkeleton && items.length === 0;

  return (
    <div>
      <div role="table" aria-label="Inventory items" aria-busy={isLoading} className="min-w-[820px]">
        <div
          role="row"
          className={cn(
            ROW_GRID_CLASS,
            "items-center px-3 pb-2 text-[11px] font-semibold tracking-wide text-neutral-400 uppercase"
          )}
        >
          <div role="columnheader">Product</div>
          <div role="columnheader">Type</div>
          <div role="columnheader">Brand</div>
          <div role="columnheader">Stock</div>
          <div role="columnheader" className="sr-only">
            Open
          </div>
        </div>

        {/* No fixed-height scroll box — a two-row filtered view used to sit in
            a half-viewport container with blank space below it. The list now
            sizes to its content and the page scrolls normally. */}
        <div className={cn("flex flex-col gap-1.5", isLoading && items.length > 0 && "opacity-60 transition-opacity")}>
          {showSkeleton &&
            Array.from({ length: 10 }).map((_, i) => (
              <div
                key={`skeleton-${i}`}
                className={cn(ROW_GRID_CLASS, "items-center rounded-[10px] border border-neutral-200 bg-white px-3 py-2.5")}
              >
                {Array.from({ length: 5 }).map((__, j) => (
                  <Skeleton key={j} className="h-5 w-full max-w-24" />
                ))}
              </div>
            ))}

          {showEmpty && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-neutral-100">
                {hasActiveFilters ? (
                  <PackageSearch className="size-6 text-neutral-400" />
                ) : (
                  <Package className="size-6 text-neutral-400" />
                )}
              </div>
              {hasActiveFilters ? (
                <>
                  <p className="text-sm font-semibold text-neutral-900">No items match your filters</p>
                  <p className="text-sm text-neutral-500">Try adjusting the search or filters above.</p>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-neutral-900">No inventory yet</p>
                  <p className="text-sm text-neutral-500">
                    Add your first product from the Purchases screen to start tracking stock.
                  </p>
                </>
              )}
            </div>
          )}

          {!showSkeleton &&
            items.map((item) => {
              const tone = stockRowTone(item);
              return (
                <button
                  key={item.id}
                  type="button"
                  role="row"
                  onClick={() => onOpenItem(item)}
                  aria-label={`Open ${item.productName}`}
                  className={cn(
                    ROW_GRID_CLASS,
                    "group items-center rounded-[10px] border px-3 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-1 focus-visible:outline-hidden",
                    tone ? ROW_TONE_CLASS[tone] : "border-neutral-200 bg-white hover:bg-neutral-50"
                  )}
                >
                  <div role="cell" className="flex items-center gap-2.5 overflow-hidden">
                    <ProductThumbnail item={item} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-neutral-900" title={item.productName}>
                        {item.productName}
                      </div>
                      <div className="truncate font-mono text-[11px] text-neutral-500">{item.skuCode}</div>
                    </div>
                  </div>

                  <div role="cell" className="min-w-0">
                    <span
                      title={getItemTypeBadgeText(item)}
                      className={cn(
                        "inline-flex w-fit max-w-full items-center truncate rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
                        ITEM_TYPE_BADGE_CLASS[item.itemType]
                      )}
                    >
                      {getItemTypeBadgeText(item)}
                    </span>
                  </div>

                  <div role="cell" className="min-w-0 truncate text-xs text-neutral-600">
                    {item.brandName ?? <span className="text-neutral-400">—</span>}
                  </div>

                  <div role="cell">
                    {/* Quantity AND threshold are spelled out, so the state is
                        legible without relying on the tint or the colour. */}
                    <div className={cn("text-sm font-semibold", STOCK_TEXT_CLASS[item.stockStatus])}>
                      {formatStockRatio(item)}
                    </div>
                    <div className="mt-1 h-1 w-full max-w-[100px] overflow-hidden rounded-full bg-neutral-200/70">
                      <div
                        className={cn("h-full rounded-full transition-all", STOCK_PROGRESS_CLASS[item.stockStatus])}
                        style={{ width: `${stockProgressPercent(item)}%` }}
                      />
                    </div>
                  </div>

                  <div role="cell" className="flex justify-end">
                    <ChevronRight className="size-4 text-neutral-300 group-hover:text-neutral-500" aria-hidden="true" />
                  </div>
                </button>
              );
            })}
        </div>
      </div>

      <div className="flex flex-col items-center justify-between gap-3 pt-4 sm:flex-row">
        <p className="text-sm text-neutral-500">
          {total === 0 ? "No items" : `Showing ${rangeStart} to ${rangeEnd} of ${total} items`}
        </p>
        <div className="flex items-center gap-1.5">
          <Button
            variant="secondary"
            size="icon"
            className="size-9 rounded-[10px]"
            onClick={() => onPageChange(page - 1)}
            disabled={isLoading || page <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft className="size-4" />
          </Button>

          {pageNumbers.map((p, i) =>
            p === "ellipsis" ? (
              <span key={`ellipsis-${i}`} className="px-1.5 text-sm text-neutral-400">
                …
              </span>
            ) : (
              <Button
                key={p}
                variant={p === page ? "primary" : "secondary"}
                size="icon"
                className={cn("size-9 rounded-[10px]", p === page && "bg-danger hover:bg-danger/90")}
                onClick={() => onPageChange(p)}
                disabled={isLoading}
                aria-label={`Page ${p}`}
                aria-current={p === page ? "page" : undefined}
              >
                {p}
              </Button>
            )
          )}

          <Button
            variant="secondary"
            size="icon"
            className="size-9 rounded-[10px]"
            onClick={() => onPageChange(page + 1)}
            disabled={isLoading || page >= totalPages}
            aria-label="Next page"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
