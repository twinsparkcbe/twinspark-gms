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
import type { OnlineOrderRow } from "@/services/online-orders";

/** Shared confirm dialog for Approve and Dispatch — both are a single
 * "are you sure" action with no extra input, just different copy/risk
 * level (Dispatch decrements Track Tyre stock, Approve doesn't). */
export function ConfirmOrderActionDialog({
  open,
  onOpenChange,
  order,
  title,
  description,
  confirmLabel,
  confirmingLabel,
  variant = "primary",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: OnlineOrderRow | null;
  title: string;
  description: (order: OnlineOrderRow) => string;
  confirmLabel: string;
  confirmingLabel: string;
  variant?: "primary" | "danger";
  onConfirm: (order: OnlineOrderRow) => Promise<{ success: boolean; error?: string }>;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (!order) return null;
  const currentOrder = order;

  async function handleConfirm() {
    setIsSubmitting(true);
    setError("");
    const result = await onConfirm(currentOrder);
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
          <DialogDescription>{description(currentOrder)}</DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-danger">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="button" variant={variant} onClick={handleConfirm} disabled={isSubmitting}>
            {isSubmitting ? confirmingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
