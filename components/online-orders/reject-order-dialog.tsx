"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { OnlineOrderRow } from "@/services/online-orders";

/** Reachable from SUBMITTED or PAYMENT_VERIFIED only — no stock impact
 * since Dispatch never ran (doc/online-orders-scope.md §2/§7). A reason is
 * required, same convention as every other correction in this system. */
export function RejectOrderDialog({
  open,
  onOpenChange,
  order,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: OnlineOrderRow | null;
  onSubmit: (order: OnlineOrderRow, reason: string) => Promise<{ success: boolean; error?: string }>;
}) {
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setReason("");
      setError("");
    }
  }, [open, order]);

  if (!order) return null;
  const currentOrder = order;

  async function handleSubmit() {
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setIsSubmitting(true);
    const result = await onSubmit(currentOrder, reason.trim());
    setIsSubmitting(false);

    if (result.success) {
      onOpenChange(false);
    } else if (result.error) {
      setError(result.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reject Order</DialogTitle>
          <DialogDescription>
            {currentOrder.customerName} · {currentOrder.mobileNumber}
          </DialogDescription>
        </DialogHeader>

        <fieldset disabled={isSubmitting} className="space-y-1.5">
          <Label>Reason *</Label>
          <Textarea
            placeholder="e.g. Payment screenshot unreadable, address undeliverable"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setError("");
            }}
          />
          {error && <p className="text-sm text-danger">{error}</p>}
        </fieldset>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="danger" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Rejecting..." : "Reject Order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
