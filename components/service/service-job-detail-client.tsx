"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, ClipboardList, History, IndianRupee, Pencil, Printer, Receipt, RotateCcw, StickyNote, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGlobalLoader } from "@/components/shared/global-loader";
import { RecordPaymentDialog } from "@/components/shared/record-payment-dialog";
import { RelativeTime } from "@/components/shared/relative-time";
import { formatDate, formatINR } from "@/lib/format";
import type { ServiceJobRow } from "@/services/service";
import { getRowActions } from "@/services/service/row-actions";
import { balanceDueFor, formatPaidByLabel, normalizePayment, type PaymentInput } from "@/services/shared/payment";
import type { ServiceDeliveryStatus } from "@/types/database.types";

import {
  completeServiceJobAction,
  undoServiceCompletionAction,
  updateServiceDeliveryStatusAction,
  updateServiceJobStatusAction,
  updateServicePaymentStatusAction,
} from "@/app/(app)/service/actions";

import { DELIVERY_STATUS_LABELS, DeliveryStatusBadge, PaymentStatusBadge, ServiceJobStatusBadge } from "./status-badge";
import { UndoServiceJobDialog } from "./undo-service-job-dialog";

const SERVICE_DELIVERY_STATUSES: ServiceDeliveryStatus[] = ["WAITING", "READY_FOR_PICKUP", "DELIVERED"];

export function ServiceJobDetailClient({
  initialJob,
  canSetPaymentStatus,
  isAdmin,
}: {
  initialJob: ServiceJobRow;
  /** Admin only — a Mechanic completes the job and hands the bike over, but
   * doesn't mark the invoice paid (doc/mechanic-role-scope.md §1). */
  canSetPaymentStatus: boolean;
  /** Correcting a billed job and undoing a completion are Administrator-only
   * (doc/service-edit-undo-scope.md §2/§3). */
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [job, setJob] = useState(initialJob);
  const [isBusy, setIsBusy] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [undoOpen, setUndoOpen] = useState(false);
  const { runWithLoader } = useGlobalLoader();

  const rowActions = getRowActions(job, { isAdmin });
  const isEditable = rowActions.edit !== null;

  /** Reverses a completed job (doc §3). Stock comes back and the invoice
   * number is voided, so this refreshes the server-rendered route rather than
   * trusting the local copy — the job card, invoice and stock figures on
   * adjacent screens all just changed. */
  async function handleUndoCompletion({ serviceJobId, reason }: { serviceJobId: string; reason: string }) {
    const result = await undoServiceCompletionAction({ serviceJobId, reason });
    if (result.success) {
      setJob(result.data);
      router.refresh();
      toast.success("Completion undone — stock restored, invoice voided.");
      return { success: true };
    }
    return { success: false, error: result.error };
  }

  async function handleStatusChange(newStatus: "IN_PROGRESS" | "READY_FOR_DELIVERY" | "CANCELLED") {
    setIsBusy(true);
    const result = await runWithLoader(() => updateServiceJobStatusAction({ serviceJobId: job.id, newStatus }));
    setIsBusy(false);
    if (result.success) {
      setJob(result.data);
      toast.success("Status updated.");
    } else {
      toast.error(result.error);
    }
  }

  async function handleComplete() {
    setIsBusy(true);
    const result = await runWithLoader(() => completeServiceJobAction(job.id));
    setIsBusy(false);
    if (result.success) {
      setJob(result.data);
      toast.success(`Job completed — Invoice ${result.data.invoiceNumber} generated.`);
      router.push(`/service/${job.id}/invoice`);
    } else {
      toast.error(result.error);
    }
  }

  /** Replaces the old bare status dropdown: a job can no longer be flipped
   * to Paid without saying how the money came in. */
  async function handleRecordPayment(input: { id: string; payment: PaymentInput }) {
    const result = await runWithLoader(() =>
      updateServicePaymentStatusAction({ serviceJobId: input.id, payment: input.payment })
    );
    if (result.success) {
      setJob(result.data);
      toast.success("Payment recorded.");
    } else {
      toast.error(result.error);
    }
    return { success: result.success, error: result.success ? undefined : result.error };
  }

  const payment = normalizePayment(
    {
      mode: job.paymentMode,
      cashAmount: job.cashAmount,
      upiAmount: job.upiAmount,
      freeService: job.paymentStatus === "FREE_SERVICE",
    },
    job.grandTotal
  );
  const paidByLabel = formatPaidByLabel(payment);
  const balanceDue = balanceDueFor({
    paymentStatus: job.paymentStatus,
    mode: job.paymentMode,
    cashAmount: job.cashAmount,
    upiAmount: job.upiAmount,
    grandTotal: job.grandTotal,
  });

  async function handleDeliveryStatus(deliveryStatus: ServiceDeliveryStatus) {
    const result = await runWithLoader(() => updateServiceDeliveryStatusAction({ serviceJobId: job.id, deliveryStatus }));
    if (result.success) {
      setJob(result.data);
      toast.success("Delivery status updated.");
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-2.5">
          <ClipboardList className="mt-1 size-6 shrink-0 text-primary" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-extrabold tracking-tight text-neutral-900">{job.jobNumber}</h1>
              <ServiceJobStatusBadge status={job.status} />
            </div>
            <p className="mt-1 text-sm text-neutral-500">
              {job.invoiceNumber ? `Invoice ${job.invoiceNumber} · ` : ""}
              Created <RelativeTime iso={job.createdAt} />
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {isEditable && (
            <Button asChild variant="secondary" size="sm" className="rounded-[10px]">
              <Link href={`/service/${job.id}/edit`}>
                <Pencil className="size-4" />
                {rowActions.edit?.label ?? "Edit"}
              </Link>
            </Button>
          )}
          {/* Both print views stay reachable here — unlike the list row, the
              detail page has room, and someone reprinting a work-order for a
              completed job shouldn't have to hunt for it. */}
          <Button asChild variant="secondary" size="sm" className="rounded-[10px]">
            <Link href={`/service/${job.id}/job-card`}>
              <Printer className="size-4" />
              Job Card
            </Link>
          </Button>
          {job.status === "COMPLETED" && (
            <Button asChild variant="secondary" size="sm" className="rounded-[10px]">
              <Link href={`/service/${job.id}/invoice`}>
                <Receipt className="size-4" />
                Invoice
              </Link>
            </Button>
          )}
          {job.status === "COMPLETED" && rowActions.undo && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-[10px] text-danger hover:bg-danger-bg hover:text-danger"
              disabled={isBusy}
              onClick={() => setUndoOpen(true)}
            >
              <RotateCcw className="size-4" />
              {rowActions.undo.label}
            </Button>
          )}
        </div>
      </div>

      {/* Status actions */}
      {(job.status === "DRAFT" || job.status === "IN_PROGRESS" || job.status === "READY_FOR_DELIVERY") && (
        <div className="flex flex-wrap items-center gap-2 rounded-[14px] border border-neutral-200 bg-white p-4 shadow-sm">
          {job.status === "DRAFT" && (
            <Button size="sm" className="rounded-[10px]" disabled={isBusy} onClick={() => handleStatusChange("IN_PROGRESS")}>
              Start Work
            </Button>
          )}
          {job.status === "IN_PROGRESS" && (
            <Button size="sm" className="rounded-[10px]" disabled={isBusy} onClick={() => handleStatusChange("READY_FOR_DELIVERY")}>
              Mark Ready for Delivery
            </Button>
          )}
          {(job.status === "IN_PROGRESS" || job.status === "READY_FOR_DELIVERY") && (
            <Button size="sm" className="rounded-[10px] bg-success hover:bg-success/90" disabled={isBusy} onClick={handleComplete}>
              <CheckCircle2 className="size-4" />
              Complete Job
            </Button>
          )}
          <Button size="sm" variant="ghost" className="rounded-[10px] text-danger hover:bg-danger-bg hover:text-danger" disabled={isBusy} onClick={() => handleStatusChange("CANCELLED")}>
            <XCircle className="size-4" />
            Cancel Job
          </Button>
        </div>
      )}

      {rowActions.undo?.kind === "UNDO_COMPLETION" && (
        <UndoServiceJobDialog
          open={undoOpen}
          onOpenChange={setUndoOpen}
          job={job}
          action={rowActions.undo}
          onConfirm={handleUndoCompletion}
        />
      )}

      <RecordPaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        allowFreeService
        bill={{
          id: job.id,
          description: `Invoice ${job.invoiceNumber ?? job.jobNumber} · ${job.customerName} · ${job.vehicleNumber}`,
          grandTotal: job.grandTotal,
          paymentMode: job.paymentMode,
          cashAmount: job.cashAmount,
          upiAmount: job.upiAmount,
          isFreeService: job.paymentStatus === "FREE_SERVICE",
        }}
        onSubmit={handleRecordPayment}
      />

      {/* Payment / Delivery status — only meaningful once Completed (doc §11) */}
      {job.status === "COMPLETED" && (
        <div className="grid gap-4 rounded-[14px] border border-neutral-200 bg-white p-4 shadow-sm sm:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Payment Status</p>
            <div className="flex flex-wrap items-center gap-2">
              <PaymentStatusBadge status={job.paymentStatus ?? "PENDING"} />
              {canSetPaymentStatus && (
                <Button size="sm" variant="secondary" className="rounded-[10px]" disabled={isBusy} onClick={() => setPaymentOpen(true)}>
                  <IndianRupee className="size-4" />
                  Record payment
                </Button>
              )}
            </div>
            {/* Tender, once known — the status badge alone can't answer
                "cash or UPI?", which is the whole point of tracking it. */}
            {paidByLabel && <p className="text-xs text-neutral-500">{paidByLabel}</p>}
            {balanceDue > 0 && <p className="text-xs font-medium text-danger">{formatINR(balanceDue)} still due</p>}
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Delivery Status</p>
            <div className="flex items-center gap-2">
              <DeliveryStatusBadge status={job.deliveryStatus ?? "WAITING"} />
              <Select value={job.deliveryStatus ?? undefined} onValueChange={(v) => handleDeliveryStatus(v as ServiceDeliveryStatus)}>
                <SelectTrigger size="sm" className="w-44 rounded-[10px]">
                  <SelectValue placeholder="Update" />
                </SelectTrigger>
                <SelectContent>
                  {SERVICE_DELIVERY_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {DELIVERY_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}

      {/* Customer & Vehicle */}
      <div className="grid gap-4 rounded-[14px] border border-neutral-200 bg-white p-4 shadow-sm sm:grid-cols-2">
        <div className="sm:col-span-2">
          <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Assigned Mechanic</p>
          <p className="mt-1 text-neutral-900">{job.assignedMechanicName ?? <span className="text-neutral-400">Unassigned</span>}</p>
        </div>
        <div>
          <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Customer</p>
          <p className="mt-1 font-semibold text-neutral-900">{job.customerName}</p>
          <p className="font-mono text-sm text-neutral-500">{job.customerMobile}</p>
          {job.customerAddress && <p className="text-sm text-neutral-500">{job.customerAddress}</p>}
        </div>
        <div>
          <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Vehicle</p>
          <p className="mt-1 font-semibold text-neutral-900">{job.vehicleNumber}</p>
          <p className="text-sm text-neutral-500">{job.vehicleModel}</p>
          <p className="text-sm text-neutral-500">{job.odometerReading.toLocaleString("en-IN")} km</p>
        </div>
      </div>

      {job.complaintNotes && (
        <div className="rounded-[14px] border border-neutral-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Customer Complaint</p>
          <p className="mt-1 text-sm text-neutral-700">{job.complaintNotes}</p>
        </div>
      )}

      {job.mechanicNotes && (
        <div className="rounded-[14px] border border-warning/30 bg-warning/5 p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
            <StickyNote className="size-3.5" />
            Mechanic Notes (internal only)
          </div>
          <p className="mt-1 text-sm text-neutral-700">{job.mechanicNotes}</p>
        </div>
      )}

      {/* Lines */}
      <div className="rounded-[14px] border border-neutral-200 bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-neutral-900">Service Lines</p>
        {job.lines.length === 0 ? (
          <p className="text-sm text-neutral-500">No service lines yet.</p>
        ) : (
          <div className="divide-y divide-neutral-100">
            {job.lines.map((line) => (
              <div key={line.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-neutral-700">
                  {line.description} {line.quantity > 1 && <span className="text-neutral-400">× {line.quantity}</span>}
                </span>
                <span className="font-medium text-neutral-900">{formatINR(line.amount)}</span>
              </div>
            ))}
          </div>
        )}
        {job.usage.length > 0 && (
          <>
            <p className="mt-4 mb-2 text-sm font-semibold text-neutral-900">Parts Used</p>
            <div className="divide-y divide-neutral-100">
              {job.usage.map((u) => (
                <div key={u.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-neutral-700">
                    {u.itemName} <span className="text-neutral-400">× {u.quantityUsed}</span>
                  </span>
                  <span className="font-medium text-neutral-900">{formatINR(u.lineTotal)}</span>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="mt-4 space-y-1 border-t border-neutral-200 pt-3 text-sm">
          <div className="flex justify-between text-neutral-600">
            <span>Subtotal</span>
            <span>{formatINR(job.subtotal)}</span>
          </div>
          {job.inventoryTotal > 0 && (
            <div className="flex justify-between text-neutral-600">
              <span>Parts Used</span>
              <span>{formatINR(job.inventoryTotal)}</span>
            </div>
          )}
          {job.gstApplicable && job.gstAmount > 0 && (
            <div className="flex justify-between text-neutral-600">
              <span>GST</span>
              <span>+ {formatINR(job.gstAmount)}</span>
            </div>
          )}
          {job.discountApplicable && job.discountAmount > 0 && (
            <div className="flex justify-between text-neutral-600">
              <span>Discount</span>
              <span>− {formatINR(job.discountAmount)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-neutral-200 pt-2 text-base font-bold text-neutral-900">
            <span>{job.status === "COMPLETED" ? "Grand Total" : "Estimated Total"}</span>
            <span>{formatINR(job.grandTotal)}</span>
          </div>
        </div>
      </div>

      {/* Timeline */}
      {job.events.length > 0 && (
        <div className="rounded-[14px] border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <History className="size-4 text-primary" />
            <p className="text-sm font-semibold text-neutral-900">Timeline</p>
          </div>
          <ol className="space-y-3">
            {job.events.map((event) => (
              <li key={event.id} className="flex items-start gap-3 text-sm">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                <div>
                  <p className="text-neutral-700">{event.detail ?? event.eventType}</p>
                  <p className="text-xs text-neutral-400">{formatDate(event.createdAt)}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
