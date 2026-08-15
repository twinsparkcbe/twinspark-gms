"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PlusCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type {
  EscalateSaleInput,
  SaleFilters,
  SaleReturnInput,
  SaleReturnRow,
  SaleRow,
  SalesStats,
  UndoSaleReturnInput,
} from "@/services/sales";
import type { UserRole } from "@/lib/auth/permissions";
import { formatDate } from "@/lib/format";
import type { PaymentInput } from "@/services/shared/payment";
import type { StaffOption } from "@/services/users";

import {
  escalateSaleToServiceAction,
  fetchSalesAction,
  editSaleAction,
  voidSaleAction,
  fetchSalesStatsAction,
  listReturnsForSaleAction,
  recordSaleReturnAction,
  undoSaleReturnAction,
  updateSalePaymentAction,
} from "@/app/(app)/sales/actions";

import { useGlobalLoader } from "@/components/shared/global-loader";
import { RecordPaymentDialog } from "@/components/shared/record-payment-dialog";

import { EscalateToServiceDialog } from "./escalate-to-service-dialog";

import { SaleReturnDialog } from "./sale-return-dialog";
import { VoidSaleDialog } from "./void-sale-dialog";
import { SalesFilters } from "./sales-filters";
import { SalesStatsCards } from "./sales-stats";
import { SalesTable } from "./sales-table";

export interface SalesFilterState {
  search: string;
  dateFrom: string;
  dateTo: string;
  /** A profile id, the UNASSIGNED_SOLD_BY sentinel, or "" for no filter. */
  soldById: string;
}

const DEFAULT_FILTERS: SalesFilterState = { search: "", dateFrom: "", dateTo: "", soldById: "" };
const PAGE_SIZE = 10;

export function SalesPageClient({
  initialSales,
  initialTotal,
  initialStats,
  role,
  salespeople,
}: {
  initialSales: SaleRow[];
  initialTotal: number;
  initialStats: SalesStats;
  role: UserRole;
  /** Active Admins + Sales Persons, for the Sold-by filter (§2). */
  salespeople: StaffOption[];
}) {
  const router = useRouter();

  const [filters, setFilters] = useState<SalesFilterState>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [sales, setSales] = useState(initialSales);
  const [total, setTotal] = useState(initialTotal);
  const [isLoading, setIsLoading] = useState(false);
  const [stats, setStats] = useState(initialStats);

  const [returnDialog, setReturnDialog] = useState<{ open: boolean; sale: SaleRow | null }>({
    open: false,
    sale: null,
  });
  const [paymentDialog, setPaymentDialog] = useState<{ open: boolean; sale: SaleRow | null }>({
    open: false,
    sale: null,
  });
  const [escalateDialog, setEscalateDialog] = useState<{ open: boolean; sale: SaleRow | null }>({
    open: false,
    sale: null,
  });
  const [voidDialog, setVoidDialog] = useState<{ open: boolean; sale: SaleRow | null }>({
    open: false,
    sale: null,
  });

  // Existing (undoable) returns for whichever sale the Return dialog is
  // currently open on — doc/sales-module-scope.md §6a.
  const [existingReturns, setExistingReturns] = useState<SaleReturnRow[]>([]);
  const [loadingReturns, setLoadingReturns] = useState(false);

  const isTextChangeRef = useRef(false);
  const hasMountedRef = useRef(false);
  const { runWithLoader } = useGlobalLoader();

  const refetch = useCallback(async () => {
    setIsLoading(true);
    const result = await runWithLoader(() =>
      fetchSalesAction({
        search: filters.search || undefined,
        dateFrom: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
        dateTo: filters.dateTo ? new Date(`${filters.dateTo}T23:59:59.999`) : undefined,
        soldById: filters.soldById || undefined,
        page,
        pageSize: PAGE_SIZE,
      })
    );
    setIsLoading(false);

    if (result.success) {
      setSales(result.data.sales);
      setTotal(result.data.total);
    } else {
      toast.error(result.error);
    }
  }, [filters, page, runWithLoader]);

  // Mirrors whatever the list is currently filtered to — no filters means
  // the usual "this month" default (getSalesStats' own fallback); any
  // active filter narrows the cards to match the filtered set exactly, so
  // they never disagree with what's showing in the table below them.
  const refreshStats = useCallback(async () => {
    const result = await runWithLoader(() =>
      fetchSalesStatsAction({
        search: filters.search || undefined,
        from: filters.dateFrom || undefined,
        to: filters.dateTo ? `${filters.dateTo}T23:59:59.999` : undefined,
      })
    );
    if (result.success) setStats(result.data);
  }, [filters, runWithLoader]);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    const delay = isTextChangeRef.current ? 300 : 0;
    const handle = setTimeout(() => {
      refetch();
      refreshStats();
    }, delay);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, page]);

  function handleFilterChange(next: Partial<SalesFilterState>) {
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

  const hasActiveFilters =
    filters.search !== "" || filters.dateFrom !== "" || filters.dateTo !== "" || filters.soldById !== "";

  const refreshExistingReturns = useCallback(async (saleId: string) => {
    setLoadingReturns(true);
    const result = await listReturnsForSaleAction(saleId);
    setLoadingReturns(false);
    if (result.success) {
      setExistingReturns(result.data);
    } else {
      toast.error(result.error);
    }
  }, []);

  // Load this sale's existing returns whenever the Return dialog opens on
  // it — reset to empty when it closes so a stale list never flashes for
  // the next sale it's opened against.
  useEffect(() => {
    if (returnDialog.open && returnDialog.sale) {
      refreshExistingReturns(returnDialog.sale.id);
    } else {
      setExistingReturns([]);
    }
  }, [returnDialog.open, returnDialog.sale, refreshExistingReturns]);

  async function handleReturnSubmit(input: SaleReturnInput) {
    const result = await recordSaleReturnAction(input);
    if (result.success) {
      toast.success("Sale return recorded.");
      const saleId = returnDialog.sale?.id;
      await Promise.all([refetch(), refreshStats(), saleId ? refreshExistingReturns(saleId) : Promise.resolve()]);
    } else {
      toast.error(result.error);
    }
    return result;
  }

  async function handleUndoReturn(input: UndoSaleReturnInput) {
    const result = await undoSaleReturnAction(input);
    if (result.success) {
      toast.success("Sale return undone.");
      const saleId = returnDialog.sale?.id;
      await Promise.all([refetch(), refreshStats(), saleId ? refreshExistingReturns(saleId) : Promise.resolve()]);
    } else {
      toast.error(result.error);
    }
    return result;
  }

  async function handleRecordPayment(input: { id: string; payment: PaymentInput }) {
    const result = await updateSalePaymentAction({ saleId: input.id, payment: input.payment });
    if (result.success) {
      toast.success("Payment recorded.");
      // Stats too: settling a bill doesn't change the amount billed, but the
      // list row's Paid chip and any outstanding figure both move.
      await Promise.all([refetch(), refreshStats()]);
    } else {
      toast.error(result.error);
    }
    return result;
  }

  /** Voiding moves stock and removes the sale from every revenue figure, so
   * both the table and the stat cards are refetched rather than patched. */
  async function handleVoidSubmit(input: { saleId: string; reason: string }) {
    const result = await voidSaleAction(input);
    if (result.success) {
      toast.success(`Invoice ${result.data.invoiceNumber} voided — stock restored.`);
      await Promise.all([refetch(), refreshStats()]);
      return { success: true };
    }
    toast.error(result.error);
    return { success: false, error: result.error };
  }

  async function handleEscalateSubmit(input: EscalateSaleInput) {
    const result = await escalateSaleToServiceAction(input);
    if (result.success) {
      toast.success("Sale flagged for Service follow-up.");
      await refetch();
    } else {
      toast.error(result.error);
    }
    return result;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-neutral-900 sm:text-3xl">Sales</h1>
          <p className="mt-1 text-sm text-neutral-500">Counter sales, installation charges, and invoices.</p>
        </div>
        <div className="flex gap-2">
          <Button
            className="w-full rounded-[10px] bg-danger hover:bg-danger/90 sm:w-auto"
            onClick={() => router.push("/sales/new")}
          >
            <PlusCircle className="size-4" />
            New Sale
          </Button>
        </div>
      </div>

      {/* <SalesStatsCards stats={stats} isFiltered={hasActiveFilters} /> */}

      <SalesFilters
        filters={filters}
        onChange={handleFilterChange}
        onReset={handleResetFilters}
        salespeople={salespeople}
      />

      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-neutral-900">
          Sales <span className="font-normal text-neutral-400">({total.toLocaleString("en-IN")})</span>
        </p>
      </div>

      <SalesTable
        sales={sales}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        isLoading={isLoading}
        hasActiveFilters={hasActiveFilters}
        onPageChange={handlePageChange}
        onReturn={(sale) => setReturnDialog({ open: true, sale })}
        onEscalate={(sale) => setEscalateDialog({ open: true, sale })}
        onRecordPayment={(sale) => setPaymentDialog({ open: true, sale })}
        canReturn={role === "admin"}
        canCorrect={role === "admin" || role === "sales_person"}
        onEdit={(sale) => router.push(`/sales/${sale.id}/edit`)}
        onVoid={(sale) => setVoidDialog({ open: true, sale })}
      />

      <VoidSaleDialog
        open={voidDialog.open}
        onOpenChange={(open) => setVoidDialog((prev) => ({ ...prev, open }))}
        sale={voidDialog.sale}
        onConfirm={handleVoidSubmit}
      />

      <RecordPaymentDialog
        open={paymentDialog.open}
        onOpenChange={(open) => setPaymentDialog((prev) => ({ ...prev, open }))}
        bill={
          paymentDialog.sale && {
            id: paymentDialog.sale.id,
            description: `Invoice ${paymentDialog.sale.invoiceNumber} · ${paymentDialog.sale.customerName} · ${formatDate(paymentDialog.sale.saleDate)}`,
            grandTotal: paymentDialog.sale.grandTotal,
            paymentMode: paymentDialog.sale.paymentMode,
            cashAmount: paymentDialog.sale.cashAmount,
            upiAmount: paymentDialog.sale.upiAmount,
          }
        }
        onSubmit={handleRecordPayment}
      />

      <SaleReturnDialog
        open={returnDialog.open}
        onOpenChange={(open) => setReturnDialog((prev) => ({ ...prev, open }))}
        sale={returnDialog.sale}
        onSubmit={handleReturnSubmit}
        existingReturns={existingReturns}
        loadingReturns={loadingReturns}
        onUndo={handleUndoReturn}
      />

      <EscalateToServiceDialog
        open={escalateDialog.open}
        onOpenChange={(open) => setEscalateDialog((prev) => ({ ...prev, open }))}
        sale={escalateDialog.sale}
        onSubmit={handleEscalateSubmit}
      />
    </div>
  );
}
