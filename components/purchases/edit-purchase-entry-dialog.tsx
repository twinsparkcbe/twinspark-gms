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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { PurchaseEntryEditInput, PurchaseEntryRow } from "@/services/purchases";

type SubmitResult = { success: boolean; error?: string };

function toDateInputValue(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function todayDateInputValue(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Edit Purchase — corrects a data-entry mistake on an already-recorded batch
 * (quantity, purchase price, selling price, purchase date, supplier, note).
 * Deliberately separate from Edit Item Details: this edits one batch's own
 * data, not the shared item master data. Any batch can be edited at any
 * time (confirmed decision) — reducing quantity below what's already been
 * sold/returned from this specific batch is still rejected server-side.
 */
export function EditPurchaseEntryDialog({
  open,
  onOpenChange,
  entry,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: PurchaseEntryRow | null;
  onSubmit: (entryId: string, input: PurchaseEntryEditInput) => Promise<SubmitResult>;
}) {
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(todayDateInputValue());
  const [supplierName, setSupplierName] = useState("");
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open && entry) {
      setQuantity(String(entry.quantity));
      setUnitPrice(String(entry.unitPrice));
      setSellingPrice(String(entry.sellingPrice));
      setPurchaseDate(toDateInputValue(entry.purchaseDate));
      setSupplierName(entry.supplierName ?? "");
      setNote(entry.note ?? "");
      setErrors({});
    }
  }, [open, entry]);

  if (!entry) return null;

  // Bind to a const so TypeScript's null-narrowing survives into the nested
  // handleSubmit closure below (same pattern as PurchaseReturnDialog).
  const currentEntry = entry;
  const consumed = currentEntry.quantity - currentEntry.remainingQuantity;

  const quantityNum = Math.trunc(Number(quantity) || 0);
  const unitPriceNum = Number(unitPrice) || 0;
  const sellingPriceNum = Number(sellingPrice) || 0;
  const totalAmount = quantityNum > 0 && unitPriceNum > 0 ? quantityNum * unitPriceNum : 0;

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if (quantityNum <= 0) next.quantity = "Quantity must be greater than 0";
    else if (quantityNum < consumed) {
      next.quantity = `Can't go below ${consumed} — that's already been sold or returned from this batch.`;
    }
    if (unitPriceNum <= 0) next.unitPrice = "Purchase price must be greater than 0";
    if (sellingPriceNum <= 0) next.sellingPrice = "Selling price must be greater than 0";
    if (!purchaseDate) next.purchaseDate = "Purchase date is required";
    else if (new Date(purchaseDate).getTime() > Date.now()) next.purchaseDate = "Purchase date cannot be in the future";
    return next;
  }

  async function handleSubmit() {
    const validationErrors = validate();
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    setIsSubmitting(true);
    const result = await onSubmit(currentEntry.id, {
      quantity: quantityNum,
      unitPrice: unitPriceNum,
      sellingPrice: sellingPriceNum,
      purchaseDate: new Date(purchaseDate),
      supplierName: supplierName.trim() || undefined,
      note: note.trim() || undefined,
    });
    setIsSubmitting(false);

    if (result.success) {
      onOpenChange(false);
    } else if (result.error) {
      setErrors({ form: result.error });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit Purchase</DialogTitle>
          <DialogDescription>
            {currentEntry.itemName} · SKU: {currentEntry.itemSkuCode} · Batch {currentEntry.batchNumber}
          </DialogDescription>
        </DialogHeader>

        <fieldset disabled={isSubmitting} className="space-y-4">
          {consumed > 0 && (
            <p className="rounded-md bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
              {consumed} unit{consumed === 1 ? "" : "s"} already sold or returned from this batch — quantity
              can&apos;t drop below that.
            </p>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Quantity *</Label>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={quantity}
                onChange={(e) => {
                  setQuantity(e.target.value);
                  setErrors((prev) => ({ ...prev, quantity: "" }));
                }}
              />
              {errors.quantity && <p className="text-sm text-danger">{errors.quantity}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Purchase Price / Unit *</Label>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={unitPrice}
                onChange={(e) => {
                  setUnitPrice(e.target.value);
                  setErrors((prev) => ({ ...prev, unitPrice: "" }));
                }}
              />
              {errors.unitPrice && <p className="text-sm text-danger">{errors.unitPrice}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Selling Price / Unit *</Label>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={sellingPrice}
                onChange={(e) => {
                  setSellingPrice(e.target.value);
                  setErrors((prev) => ({ ...prev, sellingPrice: "" }));
                }}
              />
              {errors.sellingPrice && <p className="text-sm text-danger">{errors.sellingPrice}</p>}
            </div>
          </div>

          {totalAmount > 0 && (
            <div className="flex items-center justify-between rounded-md bg-neutral-50 px-3 py-2">
              <span className="text-sm text-neutral-600">Total Purchase Amount</span>
              <span className="font-mono text-sm font-bold text-neutral-900">
                {totalAmount.toLocaleString("en-IN", { style: "currency", currency: "INR" })}
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Purchase Date *</Label>
              <Input
                type="date"
                max={todayDateInputValue()}
                value={purchaseDate}
                onChange={(e) => {
                  setPurchaseDate(e.target.value);
                  setErrors((prev) => ({ ...prev, purchaseDate: "" }));
                }}
              />
              {errors.purchaseDate && <p className="text-sm text-danger">{errors.purchaseDate}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Supplier Name (optional)</Label>
              <Input
                placeholder="e.g. ABC Tyre Distributors"
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Note (optional)</Label>
            <Textarea
              placeholder="e.g. Corrected a data-entry mistake"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {errors.form && <p className="text-sm text-danger">{errors.form}</p>}
        </fieldset>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
