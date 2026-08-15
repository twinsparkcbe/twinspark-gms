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
import type { InventoryItemRow, StockAdjustmentInput } from "@/services/inventory";

import { STOCK_ADJUSTMENT_REASON_OPTIONS } from "./constants";

type ReasonLabel = StockAdjustmentInput["reasonLabel"];

export function AdjustStockDialog({
  open,
  onOpenChange,
  item,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: InventoryItemRow | null;
  onSubmit: (input: StockAdjustmentInput) => Promise<{ success: boolean; error?: string }>;
}) {
  // Held as a string so the field can be freely typed/cleared — including a
  // lone "-" while typing "-100" — instead of snapping back to 0. Parsed to a
  // signed integer only at submit. Positive adds stock, negative reduces it.
  const [adjustment, setAdjustment] = useState("");
  const [reasonLabel, setReasonLabel] = useState<ReasonLabel>("Manual Correction");
  const [note, setNote] = useState("");
  const [customReason, setCustomReason] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [customReasonError, setCustomReasonError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setAdjustment("");
      setReasonLabel("Manual Correction");
      setNote("");
      setCustomReason("");
      setUnitCost("");
      setFormError(null);
      setCustomReasonError(null);
    }
  }, [open, item]);

  if (!item) return null;

  // Bind to a `const` so TypeScript's null-narrowing above survives into the
  // nested `handleSubmit` closure below (narrowing on a parameter like `item`
  // isn't retained across function boundaries, since parameters are
  // reassignable in principle).
  const currentItem = item;
  const delta = Math.trunc(Number(adjustment) || 0);
  const newStock = currentItem.availableQuantity + delta;
  const isOther = reasonLabel === "Other";

  function applyStep(step: number) {
    setAdjustment((prev) => String(Math.trunc(Number(prev) || 0) + step));
    setFormError(null);
  }

  async function handleSubmit() {
    if (isOther && !customReason.trim()) {
      setCustomReasonError("Specify what this reason is.");
      return;
    }
    if (delta === 0) {
      setFormError("Enter how many units to add (e.g. 100) or reduce (e.g. -100).");
      return;
    }
    if (newStock < 0) {
      setFormError("This would drop stock below zero.");
      return;
    }

    setIsSubmitting(true);
    const result = await onSubmit({
      itemId: currentItem.id,
      delta,
      reasonLabel,
      // Note is optional now — the reason label is always recorded in the
      // audit trail regardless (see toLoggedNote in stock-adjustment.ts).
      note: note.trim() || undefined,
      customReason: isOther ? customReason.trim() : undefined,
      // Only meaningful when adding stock — a new synthetic batch is
      // created at this cost, or the item's last batch cost if left blank
      // (doc/purchase-batch-fifo-scope.md §3).
      unitCost: delta > 0 && unitCost.trim() ? Number(unitCost) : undefined,
    });
    setIsSubmitting(false);

    if (result.success) {
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adjust Stock</DialogTitle>
          <DialogDescription>
            {item.productName} · SKU: {item.skuCode}
          </DialogDescription>
        </DialogHeader>

        <fieldset disabled={isSubmitting} className="space-y-4">
          <div className="flex items-center justify-between rounded-md bg-neutral-50 px-3 py-2">
            <span className="text-sm text-neutral-600">Current Stock</span>
            <span className="font-mono text-sm font-bold text-neutral-900">{item.availableQuantity}</span>
          </div>

          <div className="space-y-1.5">
            <Label>Adjustment *</Label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="icon"
                aria-label="Decrease by one"
                onClick={() => applyStep(-1)}
              >
                <Minus className="size-4" />
              </Button>
              <Input
                type="number"
                step="1"
                inputMode="numeric"
                className="text-center"
                placeholder="e.g. 100 to add, -100 to reduce"
                value={adjustment}
                onChange={(e) => {
                  setAdjustment(e.target.value);
                  setFormError(null);
                }}
              />
              <Button
                type="button"
                variant="secondary"
                size="icon"
                aria-label="Increase by one"
                onClick={() => applyStep(1)}
              >
                <Plus className="size-4" />
              </Button>
            </div>
            <p className="text-xs text-neutral-400">
              Type a positive number to add stock, or a negative number (e.g. -100) to reduce it.
            </p>
            {delta !== 0 && (
              <p
                className={
                  newStock < 0 ? "text-sm font-medium text-danger" : "text-sm font-medium text-success"
                }
              >
                {delta > 0 ? "Adding" : "Reducing"} {Math.abs(delta)} → New Stock: {newStock}
              </p>
            )}
            {formError && <p className="text-sm text-danger">{formError}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Reason *</Label>
            <Select
              value={reasonLabel}
              onValueChange={(value) => {
                setReasonLabel(value as ReasonLabel);
                setFormError(null);
                setCustomReasonError(null);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STOCK_ADJUSTMENT_REASON_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isOther && (
            <div className="space-y-1.5">
              <Label>Specify Reason *</Label>
              <Input
                placeholder="e.g. Vendor return"
                value={customReason}
                onChange={(e) => {
                  setCustomReason(e.target.value);
                  setCustomReasonError(null);
                }}
              />
              {customReasonError && <p className="text-sm text-danger">{customReasonError}</p>}
            </div>
          )}

          {delta > 0 && (
            <div className="space-y-1.5">
              <Label>Cost per Unit (optional)</Label>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                placeholder={`Defaults to last purchase cost (₹${item.purchasePrice})`}
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
              />
              <p className="text-xs text-neutral-400">
                What this stock actually cost, for accurate Inventory Value. Leave blank to reuse this
                item&apos;s most recent purchase price.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Note (optional)</Label>
            <Textarea
              placeholder="e.g. Stock verified during monthly audit."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </fieldset>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={isSubmitting || newStock < 0}>
            {isSubmitting ? "Adjusting..." : "Adjust Stock"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
