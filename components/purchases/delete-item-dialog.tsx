"use client";

import { useState } from "react";
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
import type { InventoryItemRow } from "@/services/inventory";

/** Moved from components/inventory/ — item removal now lives in Purchases
 * alongside Edit Item Details (doc/inventory-purchase-simplification-scope.md §1.2). */
export function DeleteItemDialog({
  open,
  onOpenChange,
  item,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: InventoryItemRow | null;
  onConfirm: () => Promise<{ success: boolean; data?: { action: "deleted" | "deactivated" }; error?: string }>;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!item) return null;

  async function handleConfirm() {
    setIsSubmitting(true);
    const result = await onConfirm();
    setIsSubmitting(false);

    if (result.success) {
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-warning" />
            <DialogTitle>Remove Item</DialogTitle>
          </div>
          <DialogDescription>
            If <span className="font-medium text-neutral-900">{item.productName}</span> has no purchase,
            sale, or service history, it will be permanently deleted. If it does, it will be deactivated
            instead — hidden from new transactions, but its historical data stays intact.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-neutral-200 px-3 py-2">
          <p className="text-sm font-medium text-neutral-900">{item.productName}</p>
          <p className="font-mono text-[11px] font-bold text-neutral-500">SKU: {item.skuCode}</p>
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="danger" disabled={isSubmitting} onClick={handleConfirm}>
            {isSubmitting ? "Removing..." : "Remove Item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
