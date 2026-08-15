"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Bulk counterpart to ConfirmOrderActionDialog — same shape, but for a
 * multi-select action against N orders instead of one. Each order is
 * processed independently server-side (see runBulkAction in
 * app/(app)/online-orders/actions.ts), so a partial failure doesn't block
 * the rest — onConfirm is expected to report per-order results itself
 * (toast summary) and only return {success:false} for a hard failure that
 * stopped the whole batch (e.g. an auth error), not for individual
 * order-level failures. */
export function ConfirmBulkActionDialog({
  open,
  onOpenChange,
  orderIds,
  title,
  description,
  confirmLabel,
  confirmingLabel,
  variant = "primary",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderIds: string[];
  title: string;
  description: (count: number) => string;
  confirmLabel: string;
  confirmingLabel: string;
  variant?: "primary" | "danger";
  onConfirm: (orderIds: string[]) => Promise<{ success: boolean; error?: string }>;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleConfirm() {
    setIsSubmitting(true);
    setError("");
    const result = await onConfirm(orderIds);
    setIsSubmitting(false);

    if (result.success) {
      onOpenChange(false);
    } else if (result.error) {
      setError(result.error);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!isSubmitting) onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description(orderIds.length)}</DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-danger">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="button" variant={variant} onClick={handleConfirm} disabled={isSubmitting || orderIds.length === 0}>
            {isSubmitting ? confirmingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
