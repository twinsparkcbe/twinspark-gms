"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

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
import { formatINR } from "@/lib/format";
import type { SaleRow } from "@/services/sales";

/**
 * Voiding a sale (doc/sales-edit-void-scope.md §4).
 *
 * A void is the one action in the app whose misuse is invisible in the
 * totals — it removes both the stock movement and the cash from every revenue
 * figure at once. So it never fires from a single tap: the dialog states the
 * stock going back and the money being cleared, and a reason is mandatory,
 * because months later that line is the only record of why an invoice number
 * has nothing behind it.
 */
export function VoidSaleDialog({
  open,
  onOpenChange,
  sale,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sale: SaleRow | null;
  onConfirm: (input: { saleId: string; reason: string }) => Promise<{ success: boolean; error?: string }>;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [isBusy, setIsBusy] = useState(false);
  const { runWithLoader } = useGlobalLoader();

  // Re-seeded on every open — the list mounts this once and reuses it for
  // every row, so a reason typed and abandoned must never carry over.
  useEffect(() => {
    if (open) {
      setReason("");
      setError(undefined);
    }
  }, [open, sale?.id]);

  if (!sale) return null;

  const stockLines = sale.lineItems.filter((line) => line.lineType === "PRODUCT" && (line.quantity ?? 0) > 0);
  const collected = sale.cashAmount + sale.upiAmount;

  async function handleConfirm() {
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      setError("Give a short reason (at least 3 characters).");
      return;
    }

    setIsBusy(true);
    const result = await runWithLoader(() => onConfirm({ saleId: sale!.id, reason: trimmed }));
    setIsBusy(false);

    if (result.success) {
      onOpenChange(false);
    } else {
      setError(result.error ?? "Something went wrong.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Void this sale?</DialogTitle>
          <DialogDescription>
            Invoice {sale.invoiceNumber} · {sale.customerName} · {formatINR(sale.grandTotal)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* No light warning token exists by design (globals.css: "solid, no
              light variant"), so the tint is an alpha of the same colour. */}
          <div className="rounded-[10px] border border-warning/40 bg-warning/10 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
              <div className="space-y-1.5 text-sm text-neutral-700">
                <p>
                  This sale will be marked <span className="font-semibold">Voided</span>. It keeps invoice{" "}
                  <span className="font-mono font-semibold">{sale.invoiceNumber}</span> and stays in the list, but counts as{" "}
                  <span className="font-semibold">₹0</span> in Revenue, Profit and Collections.
                </p>
                {stockLines.length > 0 && (
                  <div>
                    <p className="font-medium">These items go back into stock:</p>
                    <ul className="mt-0.5 list-disc pl-4">
                      {stockLines.map((line) => (
                        <li key={line.id}>
                          {line.itemName ?? "Item"} × {line.quantity}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {collected > 0 && (
                  <p className="font-medium text-danger">{formatINR(collected)} recorded as collected will be cleared.</p>
                )}
                <p className="text-xs text-neutral-500">
                  A void can&apos;t be undone. If the sale really happened, record it again instead — the stock may have been sold to someone else by
                  then.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="void-reason">Reason</Label>
            <Textarea
              id="void-reason"
              value={reason}
              placeholder="e.g. Billed to the wrong customer"
              aria-invalid={Boolean(error) || undefined}
              onChange={(e) => {
                setReason(e.target.value);
                setError(undefined);
              }}
            />
            {error && <p className="text-xs text-danger">{error}</p>}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={isBusy}>
            Keep the sale
          </Button>
          <Button type="button" variant="danger" onClick={handleConfirm} disabled={isBusy}>
            {isBusy ? "Voiding..." : "Void sale"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
