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
import { useGlobalLoader } from "@/components/shared/global-loader";
import type { EscalateSaleInput, SaleRow } from "@/services/sales";

/**
 * Flags a sale "Needs Service Follow-up" (scope doc §5) — no Service Job is
 * created (that module doesn't exist yet); this just makes sure the
 * customer/sale context isn't lost for whenever Service is built.
 */
export function EscalateToServiceDialog({
  open,
  onOpenChange,
  sale,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sale: SaleRow | null;
  onSubmit: (input: EscalateSaleInput) => Promise<{ success: boolean; error?: string }>;
}) {
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const { runWithLoader } = useGlobalLoader();

  useEffect(() => {
    if (open) {
      setNote("");
      setError("");
    }
  }, [open, sale]);

  if (!sale) return null;

  async function handleSubmit() {
    if (!sale) return;
    setIsSubmitting(true);
    const result = await runWithLoader(() => onSubmit({ saleId: sale.id, note: note.trim() || undefined }));
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
          <DialogTitle>Needs Service Follow-up</DialogTitle>
          <DialogDescription>
            Flags invoice {sale.invoiceNumber} for {sale.customerName} so it&apos;s ready to pick up once a Service
            Job can be created — this doesn&apos;t create a Service Job itself yet.
          </DialogDescription>
        </DialogHeader>

        <fieldset disabled={isSubmitting} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Note (optional)</Label>
            <Textarea
              placeholder="e.g. Wheel bearing looked worn during fitting, recommend inspection"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
        </fieldset>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" className="bg-danger hover:bg-danger/90" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Flagging..." : "Flag for Service"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
