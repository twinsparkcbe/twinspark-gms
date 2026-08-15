"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { OnlineOrderRow } from "@/services/online-orders";

type ActionResult = { success: boolean; error?: string };

/**
 * Doubles as the plain screenshot viewer (any status) and the primary
 * one-click workflow action for whatever step this order is currently at —
 * Verify Payment (SUBMITTED), Approve (PAYMENT_VERIFIED), or Dispatch
 * (APPROVED) — so staff don't have to close this dialog and hunt for the
 * matching icon in the table row. Reject stays table-row-only (it needs a
 * reason, which doesn't fit this dialog's single-button flow).
 *
 * Signed URL is fetched by the page client when this opens (the bucket is
 * private, no public URL exists — see getPaymentScreenshotSignedUrl in
 * services/online-orders/orders.ts).
 */
export function VerifyPaymentDialog({
  open,
  onOpenChange,
  order,
  signedUrl,
  isLoadingUrl,
  onVerify,
  onApprove,
  onDispatch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: OnlineOrderRow | null;
  signedUrl: string | null;
  isLoadingUrl: boolean;
  onVerify: (order: OnlineOrderRow) => Promise<ActionResult>;
  onApprove: (order: OnlineOrderRow) => Promise<ActionResult>;
  onDispatch: (order: OnlineOrderRow) => Promise<ActionResult>;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (!order) return null;
  const currentOrder = order;

  const primaryAction =
    currentOrder.status === "SUBMITTED"
      ? { label: "Mark Payment Verified", submittingLabel: "Verifying...", run: onVerify }
      : currentOrder.status === "PAYMENT_VERIFIED"
        ? { label: "Approve Order", submittingLabel: "Approving...", run: onApprove }
        : currentOrder.status === "APPROVED"
          ? { label: "Dispatch Order", submittingLabel: "Dispatching...", run: onDispatch }
          : null;

  async function handlePrimaryAction() {
    if (!primaryAction) return;
    setIsSubmitting(true);
    setError("");
    const result = await primaryAction.run(currentOrder);
    setIsSubmitting(false);

    if (result.success) {
      onOpenChange(false);
    } else if (result.error) {
      setError(result.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Payment Screenshot</DialogTitle>
          <DialogDescription>
            {currentOrder.customerName} · {currentOrder.mobileNumber}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-[240px] items-center justify-center rounded-[10px] border border-neutral-200 bg-neutral-50 p-2">
          {isLoadingUrl && <Loader2 className="size-6 animate-spin text-neutral-400" />}
          {!isLoadingUrl && signedUrl && (
            // Signed URL is a short-lived Supabase Storage link, not something
            // next/image's remote patterns config should need to know about.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={signedUrl}
              alt="Payment screenshot"
              className="max-h-[420px] w-full rounded-[8px] object-contain"
            />
          )}
          {!isLoadingUrl && !signedUrl && <p className="text-sm text-neutral-500">Couldn&apos;t load the screenshot.</p>}
        </div>

        {currentOrder.status === "APPROVED" && (
          <p className="text-xs text-neutral-500">Dispatching decrements Track Tyre stock and can&apos;t be undone from here.</p>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {primaryAction && (
            <Button type="button" variant="primary" onClick={handlePrimaryAction} disabled={isSubmitting}>
              {isSubmitting ? primaryAction.submittingLabel : primaryAction.label}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
