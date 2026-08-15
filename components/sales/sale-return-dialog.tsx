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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useGlobalLoader } from "@/components/shared/global-loader";
import { formatDate } from "@/lib/format";
import type { SaleReturnInput, SaleReturnRow, SaleRow, UndoSaleReturnInput } from "@/services/sales";

export function SaleReturnDialog({
  open,
  onOpenChange,
  sale,
  onSubmit,
  existingReturns,
  loadingReturns,
  onUndo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sale: SaleRow | null;
  onSubmit: (input: SaleReturnInput) => Promise<{ success: boolean; error?: string }>;
  /** Every existing (undoable) return for this sale — doc/sales-module-
   * scope.md §6a. Fetched by the parent on open, same "parent owns data,
   * dialog owns form state" split as the rest of this component. */
  existingReturns: SaleReturnRow[];
  loadingReturns?: boolean;
  onUndo: (input: UndoSaleReturnInput) => Promise<{ success: boolean; error?: string }>;
}) {
  const [saleItemId, setSaleItemId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Undo flow — a separate bit of local state since it targets one specific
  // existing return, not the "new return" form above.
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const [undoReason, setUndoReason] = useState("");
  const [undoError, setUndoError] = useState("");
  const [undoSubmitting, setUndoSubmitting] = useState(false);

  const { runWithLoader } = useGlobalLoader();

  const productLines = sale?.lineItems.filter((l) => l.lineType === "PRODUCT") ?? [];

  useEffect(() => {
    if (open) {
      setSaleItemId(productLines[0]?.id ?? null);
      setQuantity("");
      setReason("");
      setErrors({});
      setUndoingId(null);
      setUndoReason("");
      setUndoError("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sale]);

  if (!sale) return null;

  const selectedLine = productLines.find((l) => l.id === saleItemId) ?? null;
  const maxQuantity = selectedLine?.quantity ?? 0;
  const quantityNum = Math.trunc(Number(quantity) || 0);

  function applyStep(step: number) {
    setQuantity((prev) => String(Math.max(0, Math.trunc(Number(prev) || 0) + step)));
    setErrors((prev) => ({ ...prev, quantity: "" }));
  }

  async function handleSubmit() {
    const next: Record<string, string> = {};
    if (!saleItemId) next.saleItemId = "Select which item to return.";
    if (quantityNum <= 0) next.quantity = "Enter how many units to return.";
    else if (selectedLine && quantityNum > maxQuantity) {
      next.quantity = `Only ${maxQuantity} unit${maxQuantity === 1 ? "" : "s"} were sold on this line.`;
    }
    if (!reason.trim()) next.reason = "A reason is required.";

    setErrors(next);
    if (Object.keys(next).length > 0 || !saleItemId) return;

    setIsSubmitting(true);
    const result = await runWithLoader(() => onSubmit({ saleItemId, quantity: quantityNum, reason: reason.trim() }));
    setIsSubmitting(false);

    if (result.success) {
      onOpenChange(false);
    } else if (result.error) {
      setErrors({ form: result.error });
    }
  }

  function startUndo(returnId: string) {
    setUndoingId(returnId);
    setUndoReason("");
    setUndoError("");
  }

  function cancelUndo() {
    setUndoingId(null);
    setUndoReason("");
    setUndoError("");
  }

  async function handleUndo(returnId: string) {
    if (!undoReason.trim()) {
      setUndoError("A reason is required.");
      return;
    }
    setUndoSubmitting(true);
    const result = await runWithLoader(() => onUndo({ saleReturnId: returnId, reason: undoReason.trim() }));
    setUndoSubmitting(false);

    if (result.success) {
      cancelUndo();
    } else if (result.error) {
      setUndoError(result.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Return Sale Item</DialogTitle>
          <DialogDescription>
            Invoice {sale.invoiceNumber} · {sale.customerName}
          </DialogDescription>
        </DialogHeader>

        <fieldset disabled={isSubmitting} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Item *</Label>
            <Select
              value={saleItemId ?? undefined}
              onValueChange={(value) => {
                setSaleItemId(value);
                setErrors((prev) => ({ ...prev, saleItemId: "" }));
              }}
            >
              <SelectTrigger size="sm" className="w-full rounded-[10px]">
                <SelectValue placeholder="Select item" />
              </SelectTrigger>
              <SelectContent>
                {productLines.map((line) => (
                  <SelectItem key={line.id} value={line.id}>
                    {line.itemName} × {line.quantity}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.saleItemId && <p className="text-sm text-danger">{errors.saleItemId}</p>}
          </div>

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
                placeholder="e.g. 1"
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
              placeholder="e.g. Customer changed their mind, wrong item sold"
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

        {(loadingReturns || existingReturns.length > 0) && (
          <div className="space-y-2 border-t border-neutral-200 pt-4">
            <Label className="text-xs tracking-wide text-neutral-500 uppercase">Existing Returns</Label>

            {loadingReturns ? (
              <p className="text-sm text-neutral-400">Loading…</p>
            ) : (
              <div className="max-h-48 space-y-2 overflow-y-auto">
                {existingReturns.map((r) => {
                  const line = sale.lineItems.find((l) => l.id === r.saleItemId);
                  const isUndoing = undoingId === r.id;

                  return (
                    <div key={r.id} className="rounded-[10px] border border-neutral-200 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-neutral-900">
                            {line?.itemName ?? "Item"} × {r.quantity}
                          </p>
                          <p className="truncate text-xs text-neutral-500">
                            {r.reason} · {formatDate(r.createdAt)}
                          </p>
                        </div>
                        {!isUndoing && (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => startUndo(r.id)}
                            disabled={isSubmitting}
                          >
                            Undo
                          </Button>
                        )}
                      </div>

                      {isUndoing && (
                        <div className="mt-2 space-y-2">
                          <Textarea
                            placeholder="Reason for undoing this return"
                            value={undoReason}
                            disabled={undoSubmitting}
                            onChange={(e) => {
                              setUndoReason(e.target.value);
                              setUndoError("");
                            }}
                          />
                          {undoError && <p className="text-xs text-danger">{undoError}</p>}
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={cancelUndo}
                              disabled={undoSubmitting}
                            >
                              Cancel
                            </Button>
                            <Button
                              type="button"
                              variant="danger"
                              size="sm"
                              onClick={() => handleUndo(r.id)}
                              disabled={undoSubmitting}
                            >
                              {undoSubmitting ? "Undoing…" : "Confirm Undo"}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="danger" onClick={handleSubmit} disabled={isSubmitting || productLines.length === 0}>
            {isSubmitting ? "Returning..." : "Return Stock"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
