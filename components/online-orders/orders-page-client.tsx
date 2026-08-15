"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PackageSearch, Tag, Truck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { OnlineOrderRow, OnlineOrderSort, OnlineOrderStats } from "@/services/online-orders";
import type { OnlineOrderStatus } from "@/types/database.types";

import {
  approveOnlineOrderAction,
  bulkApproveOnlineOrdersAction,
  bulkDispatchOnlineOrdersAction,
  dispatchOnlineOrderAction,
  fetchOnlineOrderStatsAction,
  fetchOnlineOrdersAction,
  fetchScreenshotSignedUrlAction,
  rejectOnlineOrderAction,
  verifyOnlineOrderPaymentAction,
  type BulkOnlineOrderActionResult,
} from "@/app/(app)/online-orders/actions";

import { ConfirmBulkActionDialog } from "./confirm-bulk-action-dialog";
import { ConfirmOrderActionDialog } from "./confirm-order-action-dialog";
import { OnlineOrdersFilters } from "./orders-filters";
import { OnlineOrdersTable } from "./orders-table";
import { OnlineOrderStatsCards } from "./orders-stats";
import { RejectOrderDialog } from "./reject-order-dialog";
import { VerifyPaymentDialog } from "./verify-payment-dialog";

/** Shared toast summary for a bulk action — reports successes and failures
 * separately since a bulk action deliberately processes each order
 * independently (see runBulkAction in app/(app)/online-orders/actions.ts). */
function toastBulkResult(result: BulkOnlineOrderActionResult, verb: string) {
  if (result.succeededCount > 0) {
    toast.success(`${result.succeededCount} order${result.succeededCount === 1 ? "" : "s"} ${verb}.`);
  }
  if (result.failed.length > 0) {
    const [first, ...rest] = result.failed;
    toast.error(
      `${result.failed.length} order${result.failed.length === 1 ? "" : "s"} failed: ${first.error}${
        rest.length > 0 ? ` (+${rest.length} more)` : ""
      }`
    );
  }
}

export interface OnlineOrderFilterState {
  search: string;
  statuses: OnlineOrderStatus[];
  dateFrom: string;
  dateTo: string;
}

const DEFAULT_FILTERS: OnlineOrderFilterState = {
  search: "",
  statuses: [],
  dateFrom: "",
  dateTo: "",
};

const PAGE_SIZE = 20;

const SORT_OPTIONS: { value: OnlineOrderSort; label: string }[] = [
  { value: "newest", label: "Newest First" },
  { value: "oldest", label: "Oldest First" },
];

export function OnlineOrdersPageClient({
  initialOrders,
  initialTotal,
  initialStats,
}: {
  initialOrders: OnlineOrderRow[];
  initialTotal: number;
  initialStats: OnlineOrderStats;
}) {
  const router = useRouter();

  const [filters, setFilters] = useState<OnlineOrderFilterState>(DEFAULT_FILTERS);
  const [sortBy, setSortBy] = useState<OnlineOrderSort>("newest");
  const [page, setPage] = useState(1);
  const [orders, setOrders] = useState(initialOrders);
  const [total, setTotal] = useState(initialTotal);
  const [isLoading, setIsLoading] = useState(false);
  const [stats, setStats] = useState(initialStats);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [verifyDialog, setVerifyDialog] = useState<{
    open: boolean;
    order: OnlineOrderRow | null;
    signedUrl: string | null;
    isLoadingUrl: boolean;
  }>({ open: false, order: null, signedUrl: null, isLoadingUrl: false });
  const [approveDialog, setApproveDialog] = useState<{ open: boolean; order: OnlineOrderRow | null }>({
    open: false,
    order: null,
  });
  const [dispatchDialog, setDispatchDialog] = useState<{ open: boolean; order: OnlineOrderRow | null }>({
    open: false,
    order: null,
  });
  const [rejectDialog, setRejectDialog] = useState<{ open: boolean; order: OnlineOrderRow | null }>({
    open: false,
    order: null,
  });
  const [bulkApproveDialogOpen, setBulkApproveDialogOpen] = useState(false);
  const [bulkDispatchDialogOpen, setBulkDispatchDialogOpen] = useState(false);

  const isTextChangeRef = useRef(false);
  const hasMountedRef = useRef(false);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    const result = await fetchOnlineOrdersAction({
      search: filters.search || undefined,
      statuses: filters.statuses.length ? filters.statuses : undefined,
      dateFrom: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
      dateTo: filters.dateTo ? new Date(`${filters.dateTo}T23:59:59.999`) : undefined,
      sortBy,
      page,
      pageSize: PAGE_SIZE,
    });
    setIsLoading(false);

    if (result.success) {
      setOrders(result.data.orders);
      setTotal(result.data.total);
    } else {
      toast.error(result.error);
    }
  }, [filters, sortBy, page]);

  const refreshStats = useCallback(async () => {
    const result = await fetchOnlineOrderStatsAction();
    if (result.success) setStats(result.data);
  }, []);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    const delay = isTextChangeRef.current ? 300 : 0;
    const handle = setTimeout(() => {
      refetch();
    }, delay);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, sortBy, page]);

  function handleFilterChange(next: Partial<OnlineOrderFilterState>) {
    isTextChangeRef.current = Object.prototype.hasOwnProperty.call(next, "search");
    setFilters((prev) => ({ ...prev, ...next }));
    setPage(1);
  }

  function handleResetFilters() {
    isTextChangeRef.current = false;
    setFilters(DEFAULT_FILTERS);
    setPage(1);
  }

  function handlePageChange(nextPage: number) {
    isTextChangeRef.current = false;
    setPage(nextPage);
  }

  function handleSortChange(nextSort: OnlineOrderSort) {
    isTextChangeRef.current = false;
    setSortBy(nextSort);
    setPage(1);
  }

  const hasActiveFilters =
    filters.search !== "" || filters.statuses.length > 0 || filters.dateFrom !== "" || filters.dateTo !== "";

  function toggleSelect(orderId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  function toggleSelectAll(checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) orders.forEach((o) => next.add(o.id));
      else orders.forEach((o) => next.delete(o.id));
      return next;
    });
  }

  function handleExportLabels() {
    if (selectedIds.size === 0) {
      toast.error("Select at least one order to export labels for.");
      return;
    }
    router.push(`/online-orders/labels?ids=${Array.from(selectedIds).join(",")}`);
  }

  async function openViewScreenshot(order: OnlineOrderRow) {
    setVerifyDialog({ open: true, order, signedUrl: null, isLoadingUrl: true });
    const result = await fetchScreenshotSignedUrlAction(order.paymentScreenshotPath);
    setVerifyDialog((prev) => ({
      ...prev,
      signedUrl: result.success ? result.data : null,
      isLoadingUrl: false,
    }));
    if (!result.success) toast.error(result.error);
  }

  async function handleVerify(order: OnlineOrderRow) {
    const result = await verifyOnlineOrderPaymentAction(order.id);
    if (result.success) {
      toast.success("Payment verified.");
      await Promise.all([refetch(), refreshStats()]);
    }
    return result;
  }

  function openApproveDialog(order: OnlineOrderRow) {
    setApproveDialog({ open: true, order });
  }

  async function handleApprove(order: OnlineOrderRow) {
    const result = await approveOnlineOrderAction(order.id);
    if (result.success) {
      toast.success("Order approved.");
      await Promise.all([refetch(), refreshStats()]);
    }
    return result;
  }

  function openDispatchDialog(order: OnlineOrderRow) {
    setDispatchDialog({ open: true, order });
  }

  async function handleDispatch(order: OnlineOrderRow) {
    const result = await dispatchOnlineOrderAction(order.id);
    if (result.success) {
      toast.success("Order dispatched — stock updated.");
      await Promise.all([refetch(), refreshStats()]);
    }
    return result;
  }

  function openRejectDialog(order: OnlineOrderRow) {
    setRejectDialog({ open: true, order });
  }

  async function handleReject(order: OnlineOrderRow, reason: string) {
    const result = await rejectOnlineOrderAction({ orderId: order.id, reason });
    if (result.success) {
      toast.success("Order rejected.");
      await Promise.all([refetch(), refreshStats()]);
    }
    return result;
  }

  async function handleBulkApprove(orderIds: string[]) {
    const result = await bulkApproveOnlineOrdersAction(orderIds);
    if (result.success) {
      toastBulkResult(result.data, "approved");
      await Promise.all([refetch(), refreshStats()]);
      setSelectedIds(new Set());
      return { success: true };
    }
    return result;
  }

  async function handleBulkDispatch(orderIds: string[]) {
    const result = await bulkDispatchOnlineOrdersAction(orderIds);
    if (result.success) {
      toastBulkResult(result.data, "dispatched");
      await Promise.all([refetch(), refreshStats()]);
      setSelectedIds(new Set());
      return { success: true };
    }
    return result;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-neutral-900 sm:text-3xl">Online Orders</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Verify payments, approve, and dispatch Track Tyre orders submitted through the public order form.
          </p>
        </div>
        {/* Three long labels wrap into a ragged stack on a phone, so below sm
            they become a full-width column instead. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          <Button
            variant="secondary"
            className="rounded-[10px]"
            disabled={selectedIds.size === 0}
            onClick={() => setBulkApproveDialogOpen(true)}
          >
            <PackageSearch className="size-4" />
            Approve Selected{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
          </Button>
          <Button
            variant="secondary"
            className="rounded-[10px]"
            disabled={selectedIds.size === 0}
            onClick={() => setBulkDispatchDialogOpen(true)}
          >
            <Truck className="size-4" />
            Dispatch Selected{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
          </Button>
          <Button variant="secondary" className="rounded-[10px]" onClick={handleExportLabels}>
            <Tag className="size-4" />
            Export Courier Labels{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
          </Button>
        </div>
      </div>

      <OnlineOrderStatsCards stats={stats} />

      <OnlineOrdersFilters filters={filters} onChange={handleFilterChange} onReset={handleResetFilters} />

      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-neutral-900">
          Orders <span className="font-normal text-neutral-400">({total.toLocaleString("en-IN")})</span>
        </p>
        <Select value={sortBy} onValueChange={(value) => handleSortChange(value as OnlineOrderSort)}>
          <SelectTrigger size="sm" className="w-[170px] rounded-[10px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                Sort by: {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <OnlineOrdersTable
        orders={orders}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        isLoading={isLoading}
        hasActiveFilters={hasActiveFilters}
        selectedIds={selectedIds}
        onPageChange={handlePageChange}
        onToggleSelect={toggleSelect}
        onToggleSelectAll={toggleSelectAll}
        onViewScreenshot={openViewScreenshot}
        onApprove={openApproveDialog}
        onDispatch={openDispatchDialog}
        onReject={openRejectDialog}
      />

      <VerifyPaymentDialog
        open={verifyDialog.open}
        onOpenChange={(open) => setVerifyDialog((prev) => ({ ...prev, open }))}
        order={verifyDialog.order}
        signedUrl={verifyDialog.signedUrl}
        isLoadingUrl={verifyDialog.isLoadingUrl}
        onVerify={handleVerify}
        onApprove={handleApprove}
        onDispatch={handleDispatch}
      />

      <ConfirmOrderActionDialog
        open={approveDialog.open}
        onOpenChange={(open) => setApproveDialog((prev) => ({ ...prev, open }))}
        order={approveDialog.order}
        title="Approve Order"
        description={(order) => `Approve this order for ${order.customerName}? It will then be ready to dispatch.`}
        confirmLabel="Approve"
        confirmingLabel="Approving..."
        onConfirm={handleApprove}
      />

      <ConfirmOrderActionDialog
        open={dispatchDialog.open}
        onOpenChange={(open) => setDispatchDialog((prev) => ({ ...prev, open }))}
        order={dispatchDialog.order}
        title="Dispatch Order"
        description={(order) =>
          `Dispatch this order for ${order.customerName}? This decrements Track Tyre stock and cannot be undone from here.`
        }
        confirmLabel="Dispatch"
        confirmingLabel="Dispatching..."
        onConfirm={handleDispatch}
      />

      <RejectOrderDialog
        open={rejectDialog.open}
        onOpenChange={(open) => setRejectDialog((prev) => ({ ...prev, open }))}
        order={rejectDialog.order}
        onSubmit={handleReject}
      />

      <ConfirmBulkActionDialog
        open={bulkApproveDialogOpen}
        onOpenChange={setBulkApproveDialogOpen}
        orderIds={Array.from(selectedIds)}
        title="Approve Selected Orders"
        description={(count) =>
          `Approve ${count} selected order${count === 1 ? "" : "s"}? Only orders currently awaiting approval will actually change — others are skipped.`
        }
        confirmLabel="Approve"
        confirmingLabel="Approving..."
        onConfirm={handleBulkApprove}
      />

      <ConfirmBulkActionDialog
        open={bulkDispatchDialogOpen}
        onOpenChange={setBulkDispatchDialogOpen}
        orderIds={Array.from(selectedIds)}
        title="Dispatch Selected Orders"
        description={(count) =>
          `Dispatch ${count} selected order${count === 1 ? "" : "s"}? This decrements Track Tyre stock for each and cannot be undone from here. Only orders currently approved will actually dispatch — others are skipped.`
        }
        confirmLabel="Dispatch"
        confirmingLabel="Dispatching..."
        onConfirm={handleBulkDispatch}
      />
    </div>
  );
}
