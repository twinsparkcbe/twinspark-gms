"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
// Leaf module, not the "@/services/payments" barrel — see the note in
// payment-config-form-dialog.tsx.
import type { PaymentQrConfigRow } from "@/services/payments/qr-config";

/**
 * Delete confirmation — destructive action, so it gets its own confirm step
 * rather than firing straight off the table row's trash icon (same shape as
 * ConfirmUserStatusDialog for deactivation). The active config can't reach
 * this dialog at all — its Delete button is disabled in the table — so
 * there's no need to re-explain that guardrail here.
 */
export function ConfirmDeletePaymentConfigDialog({
  open,
  onOpenChange,
  config,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: PaymentQrConfigRow | null;
  onConfirm: (config: PaymentQrConfigRow) => Promise<{ success: boolean; error?: string }>;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (!config) return null;
  const currentConfig = config;

  async function handleConfirm() {
    setIsSubmitting(true);
    setError("");
    const result = await onConfirm(currentConfig);
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
          <DialogTitle>Delete Payment Config</DialogTitle>
          <DialogDescription>
            Delete &ldquo;{currentConfig.label}&rdquo;? This can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-danger">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="button" variant="danger" onClick={handleConfirm} disabled={isSubmitting}>
            {isSubmitting ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
