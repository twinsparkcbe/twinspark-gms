"use client";

import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatINR } from "@/lib/format";
// Imported directly from the leaf rules module (not the "@/services/purchases"
// barrel) — this is a Client Component, and the barrel also re-exports
// entries.ts/returns.ts, which are server-only (see schemas.ts for the same
// pattern on the purchases side, and BrandCombobox/item-picker-combobox for
// why type-only imports from the barrel are fine but runtime ones aren't).
import { canReturnQuantity } from "@/services/purchases/rules";
import type { PurchaseEntryRow, PurchaseReturnInput } from "@/services/purchases";

export function PurchaseReturnDialog({
  open,
  onOpenChange,
  entry,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: PurchaseEntryRow | null;
  onSubmit: (input: PurchaseReturnInput) => Promise<{ success: boolean; error?: string }>;
}) {
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setQuantity("");
      setReason("");
      setErrors({});
    }
  }, [open, entry]);

  if (!entry) return null;

  // Bind to a `const` so TypeScript's null-narrowing above survives into the
  // nested `handleSubmit` closure below (mirrors AdjustStockDialog's
  // currentItem pattern — narrowing on a parameter/prop isn't retained
  // across function boundaries).
  const currentEntry = entry;
  // remainingQuantity comes straight from the DB (purchase_entries.remaining_
  // quantity) — it already reflects anything sold out of this batch via FIFO
  // AND any prior returns, so no separate "already returned" fetch/calc is
  // needed anymore (see doc/purchase-batch-fifo-scope.md §2).
  const remaining = currentEntry.remainingQuantity;
  const quantityNum = Math.trunc(Number(quantity) || 0);

  function applyStep(step: number) {
    setQuantity((prev) => String(Math.max(0, Math.trunc(Number(prev) || 0) + step)));
    setErrors((prev) => ({ ...prev, quantity: "" }));
  }

  async function handleSubmit() {
    const next: Record<string, string> = {};
    if (quantityNum <= 0) next.quantity = "Enter how many units to return.";
    else if (!canReturnQuantity(quantityNum, remaining))
      next.quantity = `Only ${remaining} unit${remaining === 1 ? "" : "s"} remaining on this batch.`;
    if (!reason.trim()) next.reason = "A reason is required.";

    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setIsSubmitting(true);
    const result = await onSubmit({ purchaseEntryId: currentEntry.id, quantity: quantityNum, reason: reason.trim() });
    setIsSubmitting(false);

    if (result.success) {
      onOpenChange(false);
    } else if (result.error) {
      setErrors({ form: result.error });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Return Purchase</DialogTitle>
          <DialogDescription>
            {entry.itemName} · SKU: {entry.itemSkuCode} · Batch {entry.batchNumber}
          </DialogDescription>
        </DialogHeader>

        <fieldset disabled={isSubmitting} className="space-y-4">
          <div className="grid grid-cols-2 gap-2 rounded-md bg-neutral-50 px-3 py-2 text-center">
            <div>
              <p className="text-sm font-bold text-neutral-900">{entry.quantity}</p>
              <p className="text-[11px] text-neutral-500">Purchased</p>
            </div>
            <div>
              <p className="text-sm font-bold text-success">{remaining}</p>
              <p className="text-[11px] text-neutral-500">Remaining in Batch</p>
            </div>
          </div>
          <p className="text-xs text-neutral-400">
            Purchased at {formatINR(entry.unitPrice)}/unit from {entry.supplierName ?? "an unspecified supplier"} on{" "}
            {formatDate(entry.purchaseDate)}. &ldquo;Remaining&rdquo; already accounts
            for anything sold from this batch or returned previously.
          </p>

          <div className="space-y-1.5">
            <Label>Quantity to Return *</Label>
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" size="icon" aria-label="Decrease by one" onClick={() => applyStep(-1)}>
                <Minus className="size-4" />
              </Button>
              <Input
                type="number"
                step="1"
                min={0}
                inputMode="numeric"
                className="text-center"
                placeholder="e.g. 2"
                value={quantity}
                onChange={(e) => {
                  setQuantity(e.target.value);
                  setErrors((prev) => ({ ...prev, quantity: "" }));
                }}
              />
              <Button type="button" variant="secondary" size="icon" aria-label="Increase by one" onClick={() => applyStep(1)}>
                <Plus className="size-4" />
              </Button>
            </div>
            {errors.quantity && <p className="text-sm text-danger">{errors.quantity}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Reason *</Label>
            <Textarea
              placeholder="e.g. Defective batch, wrong item delivered"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setErrors((prev) => ({ ...prev, reason: "" }));
              }}
            />
            {errors.reason && <p className="text-sm text-danger">{errors.reason}</p>}
          </div>

          {errors.form && <p className="text-sm text-danger">{errors.form}</p>}
        </fieldset>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="danger" onClick={handleSubmit} disabled={isSubmitting || remaining <= 0}>
            {isSubmitting ? "Returning..." : "Return Stock"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
