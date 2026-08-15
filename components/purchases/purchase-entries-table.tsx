"use client";

import { ChevronLeft, ChevronRight, PackageSearch, Pencil, Receipt, RotateCcw, ShoppingCart, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getItemTypeBadgeText, ITEM_TYPE_BADGE_CLASS } from "@/components/inventory/constants";
import { RelativeTime } from "@/components/shared/relative-time";
import { formatDate, formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PurchaseEntryRow } from "@/services/purchases";

// Date | Item | Type | Brand | Batch | Supplier | Purchase (qty x unit price = total) | Actions
// Qty/Unit Price/Total used to be three separate columns — merged into one
// "Purchase" column (per chat feedback) so the table fits without needing
// horizontal scroll. Item is also capped (not an open-ended fr track) so it
// can't balloon on wide screens and push Actions off the visible edge. The
// whole table is still wrapped in overflow-x-auto below as a safety-net
// fallback for anything narrower than the table's min width. Actions is
// 176px to fit 4 icon buttons (Edit Item, Edit Purchase, Return, Remove).
const ROW_GRID_CLASS =
  "grid grid-cols-[100px_minmax(190px,280px)_110px_110px_120px_130px_190px_176px] gap-3";

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

export function PurchaseEntriesTable({
  entries,
  total,
  page,
  pageSize,
  isLoading,
  hasActiveFilters,
  onPageChange,
  onReturn,
  onEditItem,
  onEditPurchase,
  onRemoveItem,
  onRecordPurchase,
}: {
  entries: PurchaseEntryRow[];
  total: number;
  page: number;
  pageSize: number;
  isLoading: boolean;
  hasActiveFilters: boolean;
  onPageChange: (page: number) => void;
  onReturn: (entry: PurchaseEntryRow) => void;
  /** Opens Edit Item Details for the item behind this batch (doc/inventory-purchase-simplification-scope.md §1.2). */
  onEditItem: (entry: PurchaseEntryRow) => void;
  /** Opens Edit Purchase — corrects this batch's own quantity/price/date/supplier/note. */
  onEditPurchase: (entry: PurchaseEntryRow) => void;
  onRemoveItem: (entry: PurchaseEntryRow) => void;
  onRecordPurchase: () => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);
  const pageNumbers = getPageNumbers(page, totalPages);

  const showSkeleton = isLoading && entries.length === 0;
  const showEmpty = !showSkeleton && entries.length === 0;

  return (
    <div>
      <div className="overflow-x-auto">
        <div role="table" aria-label="Purchase history" aria-busy={isLoading} className="min-w-[1230px]">
          <div
            role="row"
            className={cn(
              ROW_GRID_CLASS,
              "items-center px-4 pb-2 text-[11px] font-semibold tracking-wide text-neutral-400 uppercase"
            )}
          >
            <div role="columnheader">Date</div>
            <div role="columnheader">Item</div>
            <div role="columnheader">Type</div>
            <div role="columnheader">Brand</div>
            <div role="columnheader">Batch</div>
            <div role="columnheader">Supplier</div>
            <div role="columnheader">Purchase</div>
            <div role="columnheader" className="sr-only">
              Actions
            </div>
          </div>

          <div className="h-[52vh] overflow-y-auto">
            <div
              className={cn(
                "flex flex-col gap-2",
                isLoading && entries.length > 0 && "opacity-60 transition-opacity"
              )}
            >
              {showSkeleton &&
                Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={`skeleton-${i}`}
                    className={cn(ROW_GRID_CLASS, "items-center rounded-[10px] border border-neutral-200 bg-white px-4 py-3 shadow-sm")}
                  >
                    {Array.from({ length: 8 }).map((__, j) => (
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
                      <Receipt className="size-6 text-neutral-400" />
                    )}
                  </div>
                  {hasActiveFilters ? (
                    <>
                      <p className="text-sm font-semibold text-neutral-900">No purchases match your filters</p>
                      <p className="text-sm text-neutral-500">Try adjusting the search or filters above.</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-semibold text-neutral-900">No purchases recorded yet</p>
                      <p className="text-sm text-neutral-500">Record your first purchase to start tracking stock-ins.</p>
                      <Button size="sm" className="mt-1 rounded-[10px] bg-danger hover:bg-danger/90" onClick={onRecordPurchase}>
                        <ShoppingCart className="size-4" />
                        Record Purchase
                      </Button>
                    </>
                  )}
                </div>
              )}

              {!showSkeleton &&
                entries.map((entry) => (
                  <div
                    key={entry.id}
                    role="row"
                    className={cn(
                      ROW_GRID_CLASS,
                      "group items-center rounded-[10px] border border-neutral-200 bg-white px-4 py-3 shadow-sm transition-colors hover:bg-neutral-50"
                    )}
                  >
                  <div role="cell" aria-label="Date" className="min-w-0">
                    <div className="text-sm text-neutral-900">{formatDate(entry.purchaseDate)}</div>
                    <div className="mt-0.5 truncate text-[11px] text-neutral-400">
                      Recorded <RelativeTime iso={entry.createdAt} />
                    </div>
                  </div>

                  <div role="cell" aria-label="Item" className="min-w-0">
                    <div className="truncate font-semibold text-neutral-900" title={entry.itemName}>
                      {entry.itemName}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[11px] font-bold text-neutral-500">
                      SKU: {entry.itemSkuCode}
                    </div>
                  </div>

                  <div role="cell" aria-label="Type" className="min-w-0">
                    <span
                      title={getItemTypeBadgeText(entry)}
                      className={cn(
                        "inline-flex w-fit max-w-full items-center truncate rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
                        ITEM_TYPE_BADGE_CLASS[entry.itemType]
                      )}
                    >
                      {getItemTypeBadgeText(entry)}
                    </span>
                  </div>

                  <div role="cell" aria-label="Brand" className="min-w-0 text-sm">
                    {entry.brandName ? (
                      <div className="truncate text-neutral-900">{entry.brandName}</div>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </div>

                  <div role="cell" aria-label="Batch" className="min-w-0">
                    <div className="truncate font-mono text-[11px] font-bold text-neutral-500" title={entry.batchNumber}>
                      {entry.batchNumber}
                    </div>
                    <div className="mt-0.5 text-[11px] text-neutral-400">{entry.remainingQuantity} left</div>
                    <div className="mt-0.5 text-[11px] font-medium text-success" title="This batch's selling price">
                      Sells @ {formatINR(entry.sellingPrice)}
                    </div>
                  </div>

                  <div role="cell" aria-label="Supplier" className="min-w-0 text-sm">
                    {entry.supplierName ? (
                      <div className="truncate text-neutral-700">{entry.supplierName}</div>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </div>

                  <div role="cell" aria-label="Purchase amount" className="min-w-0">
                    <div className="truncate text-sm text-neutral-500">
                      {entry.quantity} qty × {formatINR(entry.unitPrice)}
                    </div>
                    <div className="mt-0.5 font-semibold text-neutral-900">{formatINR(entry.totalAmount)}</div>
                  </div>

                  <div role="cell" aria-label="Actions" className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit details for ${entry.itemName}`}
                      title="Edit item details"
                      className="size-9 rounded-[10px] text-neutral-500 hover:text-neutral-900"
                      onClick={() => onEditItem(entry)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit purchase details for ${entry.itemName}, batch ${entry.batchNumber}`}
                      title="Edit quantity & price for this batch"
                      className="size-9 rounded-[10px] text-neutral-500 hover:text-neutral-900"
                      onClick={() => onEditPurchase(entry)}
                    >
                      <Receipt className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Record a return for ${entry.itemName}`}
                      title={entry.remainingQuantity > 0 ? "Return stock from this purchase" : "Nothing left in this batch to return"}
                      className="size-9 rounded-[10px] text-neutral-500 hover:text-neutral-900"
                      disabled={entry.remainingQuantity <= 0}
                      onClick={() => onReturn(entry)}
                    >
                      <RotateCcw className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${entry.itemName}`}
                      title="Remove item"
                      className="size-9 rounded-[10px] text-danger hover:bg-danger/10 hover:text-danger"
                      onClick={() => onRemoveItem(entry)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center justify-between gap-3 pt-3 sm:flex-row">
        <p className="text-sm text-neutral-500">
          {total === 0 ? "No purchases" : `Showing ${rangeStart} to ${rangeEnd} of ${total} purchases`}
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
