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
import { PaymentCapture } from "@/components/shared/payment-capture";
import { useGlobalLoader } from "@/components/shared/global-loader";
import {
  draftFromPayment,
  draftToPaymentInput,
  validatePayment,
  type PaymentDraft,
  type PaymentErrors,
  type PaymentInput,
  type PaymentMode,
} from "@/services/shared/payment";

/**
 * Settles a bill after the fact — the customer came back and paid, or paid
 * off the balance on a part-paid invoice. Shared by Sales and Service rather
 * than duplicated: the only difference between them is whether "Free
 * service" is on the menu.
 *
 * This exists because making `PARTIAL` reachable would otherwise be a dead
 * end — a bill could be left owing with no way to ever collect it in the
 * app. It also finally wires up `update_sales_payment_status()`, written in
 * migration 0024 and connected to nothing since.
 *
 * Overwrites the tender figures rather than appending an instalment: a
 * per-invoice payment history is an explicit non-goal
 * (doc/payment-split-scope.md §11).
 */
export interface PayableBill {
  id: string;
  /** Shown in the dialog subtitle — invoice number, customer, date. */
  description: string;
  grandTotal: number;
  paymentMode: PaymentMode | null;
  cashAmount: number;
  upiAmount: number;
  isFreeService?: boolean;
}

export function RecordPaymentDialog({
  open,
  onOpenChange,
  bill,
  onSubmit,
  allowFreeService = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bill: PayableBill | null;
  onSubmit: (input: { id: string; payment: PaymentInput }) => Promise<{ success: boolean; error?: string }>;
  allowFreeService?: boolean;
}) {
  const [draft, setDraft] = useState<PaymentDraft | null>(null);
  const [errors, setErrors] = useState<PaymentErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { runWithLoader } = useGlobalLoader();

  // Re-seeded on every open, so a dialog dismissed halfway through never
  // carries half-typed amounts into the next bill it's opened for.
  useEffect(() => {
    if (!open || !bill) return;
    setDraft(
      draftFromPayment(
        {
          mode: bill.paymentMode,
          cashAmount: bill.cashAmount,
          upiAmount: bill.upiAmount,
          freeService: bill.isFreeService,
        },
        bill.grandTotal
      )
    );
    setErrors({});
  }, [open, bill]);

  async function handleSubmit() {
    if (!bill || !draft) return;

    const payment = draftToPaymentInput(draft);
    const nextErrors = validatePayment(payment, bill.grandTotal);
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setIsSubmitting(true);
    const result = await runWithLoader(() => onSubmit({ id: bill.id, payment }));
    setIsSubmitting(false);

    if (result.success) onOpenChange(false);
    else setErrors({ form: result.error ?? "Failed to record payment." });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>{bill ? bill.description : "Select a bill."}</DialogDescription>
        </DialogHeader>

        {bill && draft && (
          <PaymentCapture
            grandTotal={bill.grandTotal}
            draft={draft}
            errors={errors}
            // This screen exists to change a bill's payment, so the two
            // non-tender states belong here — it's where an invoice gets
            // marked unpaid again, or a job written off.
            allowUnpaid
            allowFreeService={allowFreeService}
            onChange={(next) => {
              setDraft(next);
              setErrors({});
            }}
            className="border-0 p-0 shadow-none"
          />
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || !bill || !draft}>
            {isSubmitting ? "Saving..." : "Save payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
