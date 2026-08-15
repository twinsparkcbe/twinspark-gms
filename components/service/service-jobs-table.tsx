"use client";

import { useState } from "react";
import Link from "next/link";
import { ClipboardList, Pencil, Printer, Receipt, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ListPagination } from "@/components/shared/list-pagination";
import { RecordCard, RecordCardActions, RecordCardFields, RecordCardHeader } from "@/components/shared/record-card";
import { RecordPaymentDialog } from "@/components/shared/record-payment-dialog";
import { RelativeTime } from "@/components/shared/relative-time";
import { formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ServiceJobRow } from "@/services/service";
import { getRowActions, serviceRowPrintHref, type ServiceRowUndoAction } from "@/services/service/row-actions";
import type { PaymentInput } from "@/services/shared/payment";

import { cancelServiceJobAction, undoServiceCompletionAction, updateServicePaymentStatusAction } from "@/app/(app)/service/actions";

import { ServiceRowActions } from "./service-row-actions";
import { ServiceJobStatusBadge } from "./status-badge";
import { UndoServiceJobDialog } from "./undo-service-job-dialog";

// Job # | Vehicle | Customer | Assigned to | Status | Amount | Actions
// Actions is wider than it was: the next-step button now lives in the row
// rather than behind a trip to the detail page (rework plan Change 3), and
// carries print/edit/undo alongside it (doc/service-edit-undo-scope.md §4).
const ROW_GRID_CLASS =
  "grid grid-cols-[120px_150px_minmax(160px,220px)_140px_160px_120px_minmax(260px,300px)] gap-3";

export function ServiceJobsTable({
  jobs,
  total,
  page,
  pageSize,
  isLoading,
  hasActiveFilters,
  isAdmin,
  canRecordPayment,
  onPageChange,
  onJobUpdated,
}: {
  jobs: ServiceJobRow[];
  total: number;
  page: number;
  pageSize: number;
  isLoading: boolean;
  hasActiveFilters: boolean;
  /** Editing a billed job and reversing anything are Administrator-only
   * (scope §2/§3). The server re-checks; this only decides what's rendered. */
  isAdmin: boolean;
  /** Tracked separately from isAdmin because it answers a different question —
   * canSetServicePaymentStatus() happens to be admin-only today, and if that
   * ever widens this follows without touching the reversal gate. */
  canRecordPayment: boolean;
  onPageChange: (page: number) => void;
  /** Patches a single row after an inline status change — no full refetch,
   * so the list doesn't jump under the admin's cursor. */
  onJobUpdated: (job: ServiceJobRow) => void;
}) {
  // One dialog for the whole list rather than one per row — 20 mounted
  // dialogs per page is 20 portals fighting over focus.
  const [undoTarget, setUndoTarget] = useState<{ job: ServiceJobRow; action: ServiceRowUndoAction } | null>(null);
  const [paymentTarget, setPaymentTarget] = useState<ServiceJobRow | null>(null);

  /** "Mark paid" opens over the list instead of navigating to the job — the
   * only reason it ever left the list was that the tender has to be asked
   * for, and a dialog asks it just as well. */
  async function handleRecordPayment({ id, payment }: { id: string; payment: PaymentInput }) {
    const result = await updateServicePaymentStatusAction({ serviceJobId: id, payment });
    if (result.success) {
      onJobUpdated(result.data);
      toast.success(`${result.data.jobNumber} — payment recorded.`);
      return { success: true };
    }
    return { success: false, error: result.error };
  }

  async function handleUndoConfirm({ serviceJobId, reason }: { serviceJobId: string; reason: string }) {
    const action = undoTarget?.action;
    if (!action) return { success: false, error: "Nothing selected." };

    const result =
      action.kind === "UNDO_COMPLETION"
        ? await undoServiceCompletionAction({ serviceJobId, reason })
        : await cancelServiceJobAction({ serviceJobId, reason });

    if (result.success) {
      onJobUpdated(result.data);
      toast.success(
        action.kind === "UNDO_COMPLETION"
          ? `${result.data.jobNumber} — completion undone, stock restored.`
          : `${result.data.jobNumber} — cancelled.`
      );
      return { success: true };
    }
    return { success: false, error: result.error };
  }

  const showSkeleton = isLoading && jobs.length === 0;
  const showEmpty = !showSkeleton && jobs.length === 0;

  if (showEmpty) {
    // Rendered outside both layouts — it used to sit inside the table body,
    // which the mobile card list doesn't render.
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <ClipboardList className="size-10 text-neutral-300" />
        {hasActiveFilters ? (
          <p className="text-sm text-neutral-500">No Service Jobs match the current filters.</p>
        ) : (
          <>
            <p className="text-sm font-medium text-neutral-700">No Service Jobs yet</p>
            <p className="text-sm text-neutral-500">Jobs you create will show up here.</p>
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
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={`m-skeleton-${i}`} className="h-36 rounded-xl" />)}

        {!showSkeleton &&
          jobs.map((job) => (
            <RecordCard key={job.id}>
              <RecordCardHeader
                title={
                  <Link href={`/service/${job.id}`} className="font-mono text-primary hover:underline">
                    {job.jobNumber}
                  </Link>
                }
                subtitle={
                  <>
                    {job.vehicleNumber} · {job.vehicleModel}
                  </>
                }
                trailing={
                  <div className="flex flex-col items-end gap-1.5">
                    <span className="text-sm font-bold text-neutral-900">{formatINR(job.grandTotal)}</span>
                    <ServiceJobStatusBadge status={job.status} />
                  </div>
                }
              />
              <RecordCardFields
                fields={[
                  { label: "Customer", value: job.customerName },
                  { label: "Mobile", value: <span className="font-mono">{job.customerMobile}</span> },
                  {
                    label: "Assigned to",
                    value: job.assignedMechanicName ?? <span className="text-neutral-400">Unassigned</span>,
                  },
                ]}
              />
              <RecordCardActions>
                <ServiceRowActions
                  job={job}
                  canRecordPayment={canRecordPayment}
                  onRecordPayment={setPaymentTarget}
                  onJobUpdated={onJobUpdated}
                />
                <MobileRowActions job={job} isAdmin={isAdmin} onUndo={setUndoTarget} />
              </RecordCardActions>
            </RecordCard>
          ))}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <div role="table" aria-label="Service Jobs" aria-busy={isLoading} className="min-w-[900px]">
          <div role="row" className={cn(ROW_GRID_CLASS, "px-4 py-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase")}>
            <span>Job #</span>
            <span>Vehicle</span>
            <span>Customer</span>
            <span>Assigned to</span>
            <span>Status</span>
            <span>Amount</span>
            <span className="text-right">Actions</span>
          </div>

          {/* Fixed at 70vh with its own scrollbar — the header row above stays
              put instead of scrolling away with the rows, and the page below
              (pagination, filters) doesn't grow with the row count. */}
          <div
            className={cn(
              "flex max-h-[70vh] flex-col gap-2 overflow-y-auto pr-1",
              isLoading && jobs.length > 0 && "opacity-60 transition-opacity"
            )}
          >
            {showSkeleton &&
              Array.from({ length: 8 }).map((_, i) => (
                <div key={`skeleton-${i}`} className={cn(ROW_GRID_CLASS, "items-center rounded-[10px] border border-neutral-200 bg-white px-4 py-3 shadow-sm")}>
                  {Array.from({ length: 7 }).map((__, j) => (
                    <Skeleton key={j} className="h-5 w-full max-w-24" />
                  ))}
                </div>
              ))}

            {!showSkeleton &&
              jobs.map((job) => (
                <div
                  key={job.id}
                  role="row"
                  className={cn(ROW_GRID_CLASS, "items-center rounded-[10px] border border-neutral-200 bg-white px-4 py-3 shadow-sm transition-colors hover:bg-neutral-50")}
                >
                  <div role="cell" aria-label="Job number" className="min-w-0">
                    <Link href={`/service/${job.id}`} className="truncate font-mono text-sm font-medium text-primary hover:underline">
                      {job.jobNumber}
                    </Link>
                    <div className="mt-0.5 truncate text-[11px] text-neutral-400">
                      <RelativeTime iso={job.createdAt} />
                    </div>
                  </div>

                  <div role="cell" aria-label="Vehicle" className="min-w-0">
                    <div className="truncate font-semibold text-neutral-900">{job.vehicleNumber}</div>
                    <div className="mt-0.5 truncate text-[11px] text-neutral-500">{job.vehicleModel}</div>
                  </div>

                  <div role="cell" aria-label="Customer" className="min-w-0">
                    <div className="truncate text-neutral-900">{job.customerName}</div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-neutral-500">{job.customerMobile}</div>
                  </div>

                  <div role="cell" aria-label="Assigned mechanic" className="min-w-0">
                    {job.assignedMechanicName ? (
                      <span className="truncate text-sm text-neutral-900">{job.assignedMechanicName}</span>
                    ) : (
                      <span className="text-sm text-neutral-400">Unassigned</span>
                    )}
                  </div>

                  <div role="cell" aria-label="Status" className="min-w-0">
                    <ServiceJobStatusBadge status={job.status} />
                  </div>

                  <div role="cell" aria-label="Amount" className="min-w-0">
                    <span className="text-sm font-semibold text-neutral-900">{formatINR(job.grandTotal)}</span>
                  </div>

                  <div role="cell" aria-label="Actions" className="flex items-center justify-end gap-1">
                    <ServiceRowActions
                      job={job}
                      canRecordPayment={canRecordPayment}
                      onRecordPayment={setPaymentTarget}
                      onJobUpdated={onJobUpdated}
                    />
                    <DesktopRowActions job={job} isAdmin={isAdmin} onUndo={setUndoTarget} />
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

      {/* Free service is on the menu here for the same reason it is on the job
          screen: a warranty job billed at zero is a real outcome the counter
          needs to be able to record without leaving the list. */}
      <RecordPaymentDialog
        open={paymentTarget !== null}
        onOpenChange={(open) => {
          if (!open) setPaymentTarget(null);
        }}
        allowFreeService
        bill={
          paymentTarget
            ? {
                id: paymentTarget.id,
                description: `Invoice ${paymentTarget.invoiceNumber ?? paymentTarget.jobNumber} · ${paymentTarget.customerName} · ${paymentTarget.vehicleNumber}`,
                grandTotal: paymentTarget.grandTotal,
                paymentMode: paymentTarget.paymentMode,
                cashAmount: paymentTarget.cashAmount,
                upiAmount: paymentTarget.upiAmount,
                isFreeService: paymentTarget.paymentStatus === "FREE_SERVICE",
              }
            : null
        }
        onSubmit={handleRecordPayment}
      />

      <UndoServiceJobDialog
        open={undoTarget !== null}
        onOpenChange={(open) => {
          if (!open) setUndoTarget(null);
        }}
        job={undoTarget?.job ?? null}
        action={undoTarget?.action ?? null}
        onConfirm={handleUndoConfirm}
      />
    </div>
  );
}

type UndoHandler = (target: { job: ServiceJobRow; action: ServiceRowUndoAction }) => void;

/** Exactly one print action, chosen by status — see the module comment on
 * getRowActions() for why both used to show and why that was the bug. */
const PRINT_ICONS = { JOB_CARD: Printer, INVOICE: Receipt } as const;

function DesktopRowActions({ job, isAdmin, onUndo }: { job: ServiceJobRow; isAdmin: boolean; onUndo: UndoHandler }) {
  const actions = getRowActions(job, { isAdmin });
  const PrintIcon = PRINT_ICONS[actions.print.kind];

  return (
    <>
      <Button
        asChild
        variant="ghost"
        size="icon"
        aria-label={actions.print.label}
        title={actions.print.label}
        className="size-9 rounded-[10px] text-neutral-500 hover:text-neutral-900"
      >
        <Link href={serviceRowPrintHref(job.id, actions.print)}>
          <PrintIcon className="size-4" />
        </Link>
      </Button>

      {actions.edit && (
        <Button
          asChild
          variant="ghost"
          size="icon"
          aria-label={actions.edit.label}
          title={actions.edit.label}
          className="size-9 rounded-[10px] text-neutral-500 hover:text-neutral-900"
        >
          <Link href={`/service/${job.id}/edit`}>
            <Pencil className="size-4" />
          </Link>
        </Button>
      )}

      {actions.undo && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={actions.undo.label}
          title={actions.undo.label}
          className="size-9 rounded-[10px] text-neutral-500 hover:bg-danger-bg hover:text-danger"
          onClick={() => onUndo({ job, action: actions.undo! })}
        >
          <RotateCcw className="size-4" />
        </Button>
      )}
    </>
  );
}

/** The card list has room for words, so it uses them — the icon-only
 * treatment above is a desktop density compromise, not the preferred UI. */
function MobileRowActions({ job, isAdmin, onUndo }: { job: ServiceJobRow; isAdmin: boolean; onUndo: UndoHandler }) {
  const actions = getRowActions(job, { isAdmin });
  const PrintIcon = PRINT_ICONS[actions.print.kind];

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="rounded-[10px] text-neutral-600">
        <Link href={serviceRowPrintHref(job.id, actions.print)}>
          <PrintIcon className="size-4" />
          {actions.print.kind === "INVOICE" ? "Invoice" : "Job card"}
        </Link>
      </Button>

      {actions.edit && (
        <Button asChild variant="ghost" size="sm" className="rounded-[10px] text-neutral-600">
          <Link href={`/service/${job.id}/edit`}>
            <Pencil className="size-4" />
            Edit
          </Link>
        </Button>
      )}

      {actions.undo && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="rounded-[10px] text-neutral-600 hover:bg-danger-bg hover:text-danger"
          onClick={() => onUndo({ job, action: actions.undo! })}
        >
          <RotateCcw className="size-4" />
          {actions.undo.label}
        </Button>
      )}
    </>
  );
}
