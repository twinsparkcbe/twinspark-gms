"use client";

import Link from "next/link";
import { Ban, IndianRupee, Info, PackageSearch, Pencil, Receipt, RotateCcw, Wrench } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ListPagination } from "@/components/shared/list-pagination";
import { RecordCard, RecordCardActions, RecordCardFields, RecordCardHeader } from "@/components/shared/record-card";
import { RelativeTime } from "@/components/shared/relative-time";
import { formatDate, formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getSaleRowActions, saleHasReturn } from "@/services/sales/sale-row-actions";
import type { SaleRow } from "@/services/sales";

import { balanceDueFor, paymentChipFor } from "@/components/shared/payment-chip";

// Date | Customer | Invoice # | Items | Amount | Paid | Actions
// Fixed/minmax tracks throughout (no 1fr) — matches Purchases' entries table
// convention (components/purchases/purchase-entries-table.tsx) so extra
// space on wide screens trails after the row instead of stretching a single
// column and pushing later columns far from their neighbors.
const ROW_GRID_CLASS =
  "grid grid-cols-[100px_minmax(160px,220px)_130px_minmax(180px,280px)_120px_130px_100px_minmax(150px,180px)] gap-3";

/** The Paid cell — tender when settled, what's owed when not. Logic lives in
 * components/shared/payment-chip so it can be unit tested, and so Service can
 * show the same chip. */
function PaymentBadge({ sale }: { sale: SaleRow }) {
  const chip = paymentChipFor({
    paymentStatus: sale.paymentStatus,
    paymentMode: sale.paymentMode,
    balanceDue: balanceDueFor(sale),
  });
  return (
    <Badge variant={chip.variant} title={chip.title}>
      {chip.label}
    </Badge>
  );
}

function itemsSummary(sale: SaleRow): string {
  const productLines = sale.lineItems.filter((l) => l.lineType === "PRODUCT");
  if (productLines.length === 0) return "—";
  const first = productLines[0];
  const extra = productLines.length - 1;
  const firstLabel = `${first.itemName ?? "Item"}${first.quantity ? ` x${first.quantity}` : ""}`;
  return extra > 0 ? `${firstLabel} +${extra} more` : firstLabel;
}

/** Total units returned across every PRODUCT line on this sale — surfaced
 * in the Items cell so a completed Sale Return is visible on the list
 * itself, not just reflected silently in stock. */
function totalReturnedQuantity(sale: SaleRow): number {
  return sale.lineItems
    .filter((l) => l.lineType === "PRODUCT")
    .reduce((sum, l) => sum + l.returnedQuantity, 0);
}

export function SalesTable({
  sales,
  total,
  page,
  pageSize,
  isLoading,
  hasActiveFilters,
  onPageChange,
  onReturn,
  onEscalate,
  onRecordPayment,
  canReturn,
  canCorrect,
  onEdit,
  onVoid,
}: {
  sales: SaleRow[];
  total: number;
  page: number;
  pageSize: number;
  isLoading: boolean;
  hasActiveFilters: boolean;
  onPageChange: (page: number) => void;
  onReturn: (sale: SaleRow) => void;
  onEscalate: (sale: SaleRow) => void;
  /** Opens the Record Payment dialog. Omitted for a read-only caller. */
  onRecordPayment?: (sale: SaleRow) => void;
  /** Sale Return is admin-only (scope doc §6) — Sales Person doesn't see the action. */
  canReturn: boolean;
  /** Administrator or Sales Person may edit and void (0029). Mechanic may not,
   * even though they can record a sale. The server re-checks; this only decides
   * what's rendered. */
  canCorrect: boolean;
  onEdit: (sale: SaleRow) => void;
  onVoid: (sale: SaleRow) => void;
}) {
  const showSkeleton = isLoading && sales.length === 0;
  const showEmpty = !showSkeleton && sales.length === 0;

  /** Shared by the table row and the mobile card, so the two can't drift. */
  function saleActions(sale: SaleRow, layout: "icon" | "labelled") {
    const hasInstallation = sale.lineItems.some((l) => l.lineType === "INSTALLATION");
    const firstReturnableItem = sale.lineItems.find((l) => l.lineType === "PRODUCT");
    const labelled = layout === "labelled";
    // One source of truth for "can this sale still be corrected", shared with
    // the /sales/[id]/edit route guard — so a visible pencil can never land on
    // a redirect (doc/sales-edit-void-scope.md §4).
    const corrections = getSaleRowActions({ voidedAt: sale.voidedAt, hasReturn: saleHasReturn(sale) }, { canCorrect });

    return (
      <>
        {corrections.edit && (
          <Button
            type="button"
            variant="ghost"
            size={labelled ? "sm" : "icon"}
            aria-label={corrections.edit.label}
            title={corrections.edit.label}
            className={cn("rounded-[10px] text-neutral-500 hover:text-neutral-900", !labelled && "size-9")}
            onClick={() => onEdit(sale)}
          >
            <Pencil className="size-4" />
            {labelled && "Edit"}
          </Button>
        )}
        {corrections.void && (
          <Button
            type="button"
            variant="ghost"
            size={labelled ? "sm" : "icon"}
            aria-label={corrections.void.label}
            title={corrections.void.label}
            className={cn("rounded-[10px] text-neutral-500 hover:bg-danger-bg hover:text-danger", !labelled && "size-9")}
            onClick={() => onVoid(sale)}
          >
            <Ban className="size-4" />
            {labelled && "Void"}
          </Button>
        )}
        {/* Explain an absence that comes from the sale's own state — most often
            a return, where the fix is to undo that first. A Mechanic seeing no
            buttons gets no tooltip; they don't need one. */}
        {corrections.blockedMessage && canCorrect && (
          <span
            className={cn("inline-flex items-center text-neutral-300", !labelled && "size-9 justify-center")}
            title={corrections.blockedMessage}
            aria-label={corrections.blockedMessage}
          >
            <Info className="size-4" />
          </span>
        )}
        {hasInstallation && !sale.needsServiceFollowup && (
          <Button
            type="button"
            variant="ghost"
            size={labelled ? "sm" : "icon"}
            aria-label="Escalate to Service"
            title="Flag for Service follow-up"
            className={cn("rounded-[10px] text-neutral-500 hover:text-neutral-900", !labelled && "size-9")}
            onClick={() => onEscalate(sale)}
          >
            <Wrench className="size-4" />
            {labelled && "Service"}
          </Button>
        )}
        {canReturn && firstReturnableItem && (
          <Button
            type="button"
            variant="ghost"
            size={labelled ? "sm" : "icon"}
            aria-label="Return"
            title="Sale Return"
            className={cn("rounded-[10px] text-neutral-500 hover:text-neutral-900", !labelled && "size-9")}
            onClick={() => onReturn(sale)}
          >
            <RotateCcw className="size-4" />
            {labelled && "Return"}
          </Button>
        )}
        {sale.paymentStatus !== "PAID" && onRecordPayment && (
          <Button
            variant="ghost"
            size={labelled ? "sm" : "icon"}
            aria-label="Record payment"
            title="Record payment"
            onClick={() => onRecordPayment(sale)}
            className={cn("rounded-[10px] text-neutral-500 hover:text-neutral-900", !labelled && "size-9")}
          >
            <IndianRupee className="size-4" />
            {labelled && "Payment"}
          </Button>
        )}
        <Button
          asChild
          variant="ghost"
          size={labelled ? "sm" : "icon"}
          aria-label="View invoice"
          title="View invoice"
          className={cn("rounded-[10px] text-neutral-500 hover:text-neutral-900", !labelled && "size-9")}
        >
          <Link href={`/sales/${sale.id}/invoice`}>
            <Receipt className="size-4" />
            {labelled && "Invoice"}
          </Link>
        </Button>
      </>
    );
  }

  if (showEmpty) {
    return (
      // Rendered once, outside both layouts — it used to live inside the table
      // body, so the mobile card list would have shown nothing at all.
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <PackageSearch className="size-10 text-neutral-300" />
        {hasActiveFilters ? (
          <p className="text-sm text-neutral-500">No sales match the current filters.</p>
        ) : (
          <>
            <p className="text-sm font-medium text-neutral-700">No sales recorded yet</p>
            <p className="text-sm text-neutral-500">Sales you record will show up here.</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* Below md the 900px table becomes a card list — see
          components/shared/record-card.tsx. */}
      <div className="flex flex-col gap-2.5 md:hidden">
        {showSkeleton &&
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={`m-skeleton-${i}`} className="h-32 rounded-xl" />)}

        {!showSkeleton &&
          sales.map((sale) => {
            const returnedQty = totalReturnedQuantity(sale);
            return (
              <RecordCard key={sale.id}>
                <RecordCardHeader
                  title={sale.customerName}
                  subtitle={<span className="font-mono">{sale.customerMobile}</span>}
                  trailing={
                    <span className="text-sm font-bold text-neutral-900">{formatINR(sale.grandTotal)}</span>
                  }
                />
                <RecordCardFields
                  fields={[
                    { label: "Date", value: formatDate(sale.saleDate) },
                    {
                      label: "Invoice",
                      value: (
                        <span className="font-mono">
                          {sale.invoiceNumber}
                          {sale.voidedAt && <span className="ml-1 font-sans font-semibold text-danger uppercase">· Voided</span>}
                        </span>
                      ),
                    },
                    {
                      label: "Sold by",
                      value: sale.soldByName ?? <span className="text-neutral-400">Unassigned</span>,
                    },
                    { label: "Paid", value: <PaymentBadge sale={sale} /> },
                    {
                      label: "Items",
                      value: (
                        <span className="block truncate">
                          {itemsSummary(sale)}
                          {returnedQty > 0 && (
                            <span className="ml-1 font-medium text-danger">· {returnedQty} returned</span>
                          )}
                        </span>
                      ),
                    },
                  ]}
                />
                <RecordCardActions>{saleActions(sale, "labelled")}</RecordCardActions>
              </RecordCard>
            );
          })}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <div role="table" aria-label="Sales" aria-busy={isLoading} className="min-w-[1000px]">
          <div
            role="row"
            className={cn(ROW_GRID_CLASS, "px-4 py-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase")}
          >
            <span>Date</span>
            <span>Customer</span>
            <span>Invoice #</span>
            <span>Items</span>
            <span>Amount</span>
            <span>Sold by</span>
            <span>Paid</span>
            <span className="text-right">Actions</span>
          </div>

          {/* Fixed at 70vh with its own scrollbar — the header row above stays
              put instead of scrolling away with the rows, and the page below
              (pagination, filters) doesn't grow with the row count. */}
          <div
            className={cn(
              "flex max-h-[70vh] flex-col gap-2 overflow-y-auto pr-1",
              isLoading && sales.length > 0 && "opacity-60 transition-opacity"
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

            {!showSkeleton &&
              sales.map((sale) => {
                const returnedQty = totalReturnedQuantity(sale);

                return (
                  <div
                    key={sale.id}
                    role="row"
                    className={cn(
                      ROW_GRID_CLASS,
                      "items-center rounded-[10px] border border-neutral-200 bg-white px-4 py-3 shadow-sm transition-colors hover:bg-neutral-50"
                    )}
                  >
                    <div role="cell" aria-label="Date" className="min-w-0">
                      <div className="text-sm text-neutral-900">{formatDate(sale.saleDate)}</div>
                      <div className="mt-0.5 truncate text-[11px] text-neutral-400">
                        <RelativeTime iso={sale.createdAt} />
                      </div>
                    </div>

                    <div role="cell" aria-label="Customer" className="min-w-0">
                      <div className="truncate font-semibold text-neutral-900" title={sale.customerName}>
                        {sale.customerName}
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-neutral-500">
                        {sale.customerMobile}
                      </div>
                    </div>

                    <div role="cell" aria-label="Invoice number" className="min-w-0">
                      <span className="font-mono text-sm text-neutral-700">{sale.invoiceNumber}</span>
                      {/* The badge is the whole point of keeping a voided row
                          visible — the invoice number stays accounted for
                          instead of becoming a gap in the series (0029). */}
                      {sale.voidedAt && (
                        <div
                          className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-danger-bg px-1.5 py-0.5 text-[10px] font-semibold text-danger uppercase"
                          title={sale.voidReason ?? undefined}
                        >
                          <Ban className="size-2.5" />
                          Voided
                        </div>
                      )}
                    </div>

                    <div role="cell" aria-label="Items" className="min-w-0">
                      <div className="truncate text-sm text-neutral-700">{itemsSummary(sale)}</div>
                      {returnedQty > 0 && (
                        <div className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-danger">
                          <RotateCcw className="size-3" />
                          {returnedQty} returned
                        </div>
                      )}
                    </div>

                    <div role="cell" aria-label="Amount" className="min-w-0">
                      <span className="text-sm font-semibold text-neutral-900">{formatINR(sale.grandTotal)}</span>
                    </div>

                    <div role="cell" aria-label="Sold by" className="min-w-0">
                      {sale.soldByName ? (
                        <span className="truncate text-sm text-neutral-900">{sale.soldByName}</span>
                      ) : (
                        <span className="text-sm text-neutral-400">Unassigned</span>
                      )}
                    </div>

                    <div role="cell" aria-label="Payment" className="min-w-0">
                      <PaymentBadge sale={sale} />
                    </div>

                    <div role="cell" aria-label="Actions" className="flex justify-end gap-1">
                      {saleActions(sale, "icon")}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </div>

      <ListPagination
        page={page}
        pageSize={pageSize}
        total={total}
        isLoading={isLoading}
        onPageChange={onPageChange}
      />
    </div>
  );
}
