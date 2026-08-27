"use client";

import { Eye, PackageSearch, Truck, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ListPagination } from "@/components/shared/list-pagination";
import { RecordCard, RecordCardActions, RecordCardFields, RecordCardHeader } from "@/components/shared/record-card";
import { RelativeTime } from "@/components/shared/relative-time";
import { formatDate, formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { OnlineOrderRow } from "@/services/online-orders";

import { OnlineOrderStatusBadge } from "./status-badge";

// Every column is a fixed/bounded width (no bare `1fr`) — a flexible track
// absorbs the whole row's leftover width into itself, which left a large
// dead gap between the Status badge and the Actions icons on wide screens.
const ROW_GRID_CLASS =
  "grid grid-cols-[40px_100px_minmax(150px,200px)_100px_130px_150px_110px_150px_170px] gap-3";

function quantitySummary(order: OnlineOrderRow): string {
  const parts: string[] = [];
  if (order.quantityFront > 0) parts.push(`${order.quantityFront} Front`);
  if (order.quantityBack > 0) parts.push(`${order.quantityBack} Back`);
  return parts.join(", ") || "—";
}

/** Per-tyre selling price snapshotted at submission time — only shown for
 * whichever position was actually ordered, one line per position (rather
 * than comma-joined on one line) so a real price never gets clipped by the
 * column width. "—" means that position wasn't priced yet at submission
 * (no active item existed for it then). */
function unitPriceLines(order: OnlineOrderRow): string[] {
  const parts: string[] = [];
  if (order.quantityFront > 0) {
    parts.push(`${order.unitPriceFront !== null ? formatINR(order.unitPriceFront) : "—"} (F)`);
  }
  if (order.quantityBack > 0) {
    parts.push(`${order.unitPriceBack !== null ? formatINR(order.unitPriceBack) : "—"} (B)`);
  }
  return parts.length > 0 ? parts : ["—"];
}

export function OnlineOrdersTable({
  orders,
  total,
  page,
  pageSize,
  isLoading,
  hasActiveFilters,
  selectedIds,
  onPageChange,
  onToggleSelect,
  onToggleSelectAll,
  onViewScreenshot,
  onApprove,
  onDispatch,
  onReject,
}: {
  orders: OnlineOrderRow[];
  total: number;
  page: number;
  pageSize: number;
  isLoading: boolean;
  hasActiveFilters: boolean;
  selectedIds: Set<string>;
  onPageChange: (page: number) => void;
  onToggleSelect: (orderId: string) => void;
  onToggleSelectAll: (checked: boolean) => void;
  /** Opens the screenshot viewer — also the entry point for Verify Payment
   * when the order is still SUBMITTED (doc/online-orders-scope.md §2). */
  onViewScreenshot: (order: OnlineOrderRow) => void;
  onApprove: (order: OnlineOrderRow) => void;
  onDispatch: (order: OnlineOrderRow) => void;
  onReject: (order: OnlineOrderRow) => void;
}) {
  const showSkeleton = isLoading && orders.length === 0;
  const showEmpty = !showSkeleton && orders.length === 0;
  const allSelected = orders.length > 0 && orders.every((o) => selectedIds.has(o.id));

  /** Shared by the table row and the mobile card so the two can't drift.
   * `labelled` gives text beside each icon — a phone has no hover, so an
   * icon-only button with a title tooltip is effectively unlabelled. */
  function orderActions(order: OnlineOrderRow, layout: "icon" | "labelled") {
    const labelled = layout === "labelled";
    const size = labelled ? "sm" : "icon";
    const base = cn("rounded-[10px]", !labelled && "size-9");

    return (
      <>
        <Button
          type="button"
          variant="ghost"
          size={size}
          aria-label={order.status === "SUBMITTED" ? "Verify payment" : "View payment screenshot"}
          title={order.status === "SUBMITTED" ? "Verify Payment" : "View Screenshot"}
          className={cn(base, "text-neutral-500 hover:text-neutral-900")}
          onClick={() => onViewScreenshot(order)}
        >
          <Eye className="size-4" />
          {labelled && (order.status === "SUBMITTED" ? "Verify" : "Screenshot")}
        </Button>

        {order.status === "PAYMENT_VERIFIED" && (
          <Button
            type="button"
            variant="ghost"
            size={size}
            aria-label="Approve order"
            title="Approve"
            className={cn(base, "text-success hover:text-success")}
            onClick={() => onApprove(order)}
          >
            <PackageSearch className="size-4" />
            {labelled && "Approve"}
          </Button>
        )}

        {order.status === "APPROVED" && (
          <Button
            type="button"
            variant="ghost"
            size={size}
            aria-label="Dispatch order"
            title="Dispatch (decrements stock)"
            className={cn(base, "text-success hover:text-success")}
            onClick={() => onDispatch(order)}
          >
            <Truck className="size-4" />
            {labelled && "Dispatch"}
          </Button>
        )}

        {(order.status === "SUBMITTED" || order.status === "PAYMENT_VERIFIED") && (
          <Button
            type="button"
            variant="ghost"
            size={size}
            aria-label="Reject order"
            title="Reject"
            className={cn(base, "text-danger hover:text-danger")}
            onClick={() => onReject(order)}
          >
            <XCircle className="size-4" />
            {labelled && "Reject"}
          </Button>
        )}
      </>
    );
  }

  if (showEmpty) {
    // Outside both layouts — it used to sit inside the table body, which the
    // mobile card list never renders.
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <PackageSearch className="size-10 text-neutral-300" />
        {hasActiveFilters ? (
          <p className="text-sm text-neutral-500">No online orders match the current filters.</p>
        ) : (
          <>
            <p className="text-sm font-medium text-neutral-700">No online orders yet</p>
            <p className="text-sm text-neutral-500">Orders submitted through the public order form will show up here.</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* Below md the 1180px table becomes a card list. Bulk select survives:
          the per-order checkbox moves into the card header, and "select all"
          gets its own row above the list rather than a table header cell. */}
      <div className="md:hidden">
        {!showSkeleton && orders.length > 0 && (
          <label className="mb-2.5 flex items-center gap-2.5 px-1 text-sm text-neutral-600">
            <Checkbox
              aria-label="Select all orders on this page"
              checked={allSelected}
              onCheckedChange={(checked) => onToggleSelectAll(checked === true)}
            />
            Select all on this page
          </label>
        )}

        <div className="flex flex-col gap-2.5">
          {showSkeleton &&
            Array.from({ length: 5 }).map((_, i) => <Skeleton key={`m-skeleton-${i}`} className="h-44 rounded-xl" />)}

          {!showSkeleton &&
            orders.map((order) => (
              <RecordCard key={order.id}>
                <RecordCardHeader
                  leading={
                    <Checkbox
                      className="mt-0.5"
                      aria-label={`Select order for ${order.customerName}`}
                      checked={selectedIds.has(order.id)}
                      onCheckedChange={() => onToggleSelect(order.id)}
                    />
                  }
                  title={order.customerName}
                  subtitle={
                    <>
                      <span className="font-mono">{order.mobileNumber}</span> · {order.pinCode}
                    </>
                  }
                  trailing={
                    <div className="flex flex-col items-end gap-1.5">
                      <span className="text-sm font-bold text-neutral-900">{formatINR(order.totalAmount)}</span>
                      {order.amountIsOverridden && (
                        <span className="text-[11px] text-warning">Quoted · ours {formatINR(order.computedAmount)}</span>
                      )}
                      <OnlineOrderStatusBadge status={order.status} />
                    </div>
                  }
                />
                <RecordCardFields
                  fields={[
                    { label: "Submitted", value: formatDate(order.submittedAt) },
                    { label: "Quantity", value: quantitySummary(order) },
                    { label: "Unit price", value: unitPriceLines(order).join(" · ") },
                    ...(order.status === "REJECTED" && order.rejectionReason
                      ? [{ label: "Reason", value: order.rejectionReason }]
                      : []),
                  ]}
                />
                <RecordCardActions>{orderActions(order, "labelled")}</RecordCardActions>
              </RecordCard>
            ))}
        </div>
      </div>

      <div className="hidden overflow-x-auto md:block">
        <div role="table" aria-label="Online Orders" aria-busy={isLoading} className="min-w-[1180px]">
          <div
            role="row"
            className={cn(ROW_GRID_CLASS, "items-center px-4 py-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase")}
          >
            <Checkbox
              aria-label="Select all orders on this page"
              checked={allSelected}
              onCheckedChange={(checked) => onToggleSelectAll(checked === true)}
            />
            <span>Submitted</span>
            <span>Customer</span>
            <span>PIN Code</span>
            <span>Quantity</span>
            <span>Unit Price</span>
            <span>Amount</span>
            <span>Status</span>
            <span className="text-right">Actions</span>
          </div>

          <div className={cn("flex flex-col gap-2", isLoading && orders.length > 0 && "opacity-60 transition-opacity")}>
            {showSkeleton &&
              Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={`skeleton-${i}`}
                  className={cn(ROW_GRID_CLASS, "items-center rounded-[10px] border border-neutral-200 bg-white px-4 py-3 shadow-sm")}
                >
                  {Array.from({ length: 9 }).map((__, j) => (
                    <Skeleton key={j} className="h-5 w-full max-w-24" />
                  ))}
                </div>
              ))}

            {!showSkeleton &&
              orders.map((order) => (
                <div
                  key={order.id}
                  role="row"
                  className={cn(
                    ROW_GRID_CLASS,
                    "items-center rounded-[10px] border border-neutral-200 bg-white px-4 py-3 shadow-sm transition-colors hover:bg-neutral-50"
                  )}
                >
                  <Checkbox
                    aria-label={`Select order for ${order.customerName}`}
                    checked={selectedIds.has(order.id)}
                    onCheckedChange={() => onToggleSelect(order.id)}
                  />

                  <div role="cell" aria-label="Submitted" className="min-w-0">
                    <div className="text-sm text-neutral-900">{formatDate(order.submittedAt)}</div>
                    <div className="mt-0.5 truncate text-[11px] text-neutral-400">
                      <RelativeTime iso={order.submittedAt} />
                    </div>
                  </div>

                  <div role="cell" aria-label="Customer" className="min-w-0">
                    <div className="truncate font-semibold text-neutral-900" title={order.customerName}>
                      {order.customerName}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-neutral-500">{order.mobileNumber}</div>
                  </div>

                  <div role="cell" aria-label="PIN code" className="min-w-0">
                    <span className="font-mono text-sm text-neutral-700">{order.pinCode}</span>
                  </div>

                  <div role="cell" aria-label="Quantity" className="min-w-0 truncate text-sm text-neutral-700">
                    {quantitySummary(order)}
                  </div>

                  <div role="cell" aria-label="Unit price" className="min-w-0 text-sm text-neutral-700">
                    {unitPriceLines(order).map((line, i) => (
                      <div key={i} className="truncate">
                        {line}
                      </div>
                    ))}
                  </div>

                  <div role="cell" aria-label="Amount" className="min-w-0">
                    <span className="text-sm font-semibold text-neutral-900">{formatINR(order.totalAmount)}</span>
                    {/* Flags an order whose amount the customer entered
                        themselves, so it is visible while scanning the list
                        rather than only after opening the screenshot
                        (0036_online_order_amount_override.sql). */}
                    {order.amountIsOverridden && (
                      <p
                        className="truncate text-[11px] text-warning"
                        title={`Customer-quoted amount — our price is ${formatINR(order.computedAmount)}`}
                      >
                        Quoted · ours {formatINR(order.computedAmount)}
                      </p>
                    )}
                  </div>

                  <div role="cell" aria-label="Status" className="min-w-0">
                    <OnlineOrderStatusBadge status={order.status} />
                    {order.status === "REJECTED" && order.rejectionReason && (
                      <p className="mt-0.5 truncate text-[11px] text-neutral-400" title={order.rejectionReason}>
                        {order.rejectionReason}
                      </p>
                    )}
                  </div>

                  <div role="cell" aria-label="Actions" className="flex justify-end gap-1">
                    {orderActions(order, "icon")}
                  </div>
                </div>
              ))}
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
