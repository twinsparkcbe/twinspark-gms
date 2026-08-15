"use client";

import { useEffect, useState } from "react";
import { History, ImageOff, Loader2, SlidersHorizontal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatDate, formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { InventoryItemRow, StockMovementRow, StockStatus } from "@/services/inventory";
import type { StockMovementReason } from "@/types/database.types";

import { fetchStockMovementsAction } from "@/app/(app)/inventory/actions";

import { formatStockRatio, getItemTypeBadgeText, ITEM_TYPE_BADGE_CLASS, STOCK_STATUS_LABELS } from "./constants";

const STOCK_STATUS_BADGE_VARIANT: Record<StockStatus, "success" | "warning" | "danger"> = {
  in_stock: "success",
  low_stock: "warning",
  out_of_stock: "danger",
};

const MOVEMENT_REASON_LABELS: Record<StockMovementReason, string> = {
  PURCHASE: "Purchase",
  PURCHASE_RETURN: "Purchase return",
  SALE: "Sale",
  SALE_RETURN: "Sale return",
  SERVICE_USAGE: "Used in service",
  ONLINE_ORDER_DISPATCH: "Online order dispatched",
  MANUAL_CORRECTION: "Manual correction",
  DAMAGE: "Damage",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="shrink-0 text-xs text-neutral-500">{label}</span>
      <span className="min-w-0 truncate text-sm font-medium text-neutral-900">{children}</span>
    </div>
  );
}

function StockHistory({ itemId }: { itemId: string }) {
  const [movements, setMovements] = useState<StockMovementRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMovements(null);
    setError(null);

    fetchStockMovementsAction(itemId).then((result) => {
      // The drawer can be closed (or switched to another item) mid-request —
      // dropping a stale response keeps a slow query from overwriting a newer
      // item's history.
      if (cancelled) return;
      if (result.success) setMovements(result.data);
      else setError(result.error);
    });

    return () => {
      cancelled = true;
    };
  }, [itemId]);

  if (error) {
    return <p className="py-3 text-xs text-danger">{error}</p>;
  }

  if (movements === null) {
    return (
      <div className="flex items-center gap-2 py-3 text-xs text-neutral-400">
        <Loader2 className="size-3.5 animate-spin" />
        Loading history…
      </div>
    );
  }

  if (movements.length === 0) {
    return <p className="py-3 text-xs text-neutral-500">No stock movements recorded for this item yet.</p>;
  }

  return (
    <ul className="divide-y divide-neutral-100">
      {movements.map((movement) => (
        <li key={movement.id} className="flex items-start justify-between gap-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-neutral-900">
              {MOVEMENT_REASON_LABELS[movement.reason]}
            </p>
            <p className="truncate text-[11px] text-neutral-400">
              {formatDate(movement.createdAt)}
              {movement.note && ` · ${movement.note}`}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className={cn("text-xs font-bold", movement.delta < 0 ? "text-danger" : "text-success")}>
              {movement.delta > 0 ? "+" : "−"}
              {Math.abs(movement.delta).toLocaleString("en-IN")}
            </p>
            <p className="text-[11px] text-neutral-400">
              → {movement.resultingBalance.toLocaleString("en-IN")}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Replaces the row's kebab menu. The row itself is the target, and everything
 * the owner might want about one item lives here — including the stock history
 * that was previously unreachable from the UI entirely
 * (doc/inventory-redesign-scope.md §3f).
 *
 * Adjust Stock stays the only write action; prices are shown read-only because
 * they're auto-synced mirrors of the latest purchase batch and are not
 * editable anywhere (doc/inventory-purchase-simplification-scope.md).
 */
export function ItemDetailDrawer({
  item,
  open,
  onOpenChange,
  onAdjustStock,
}: {
  item: InventoryItemRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdjustStock: (item: InventoryItemRow) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        {item && (
          <>
            <SheetHeader>
              <div className="flex items-start gap-3">
                {item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- dynamic Supabase Storage URL
                  <img
                    src={item.imageUrl}
                    alt=""
                    className="size-12 shrink-0 rounded-[10px] border border-neutral-200 object-cover"
                  />
                ) : (
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-[10px] border border-neutral-200 bg-neutral-50">
                    <ImageOff className="size-4 text-neutral-300" />
                  </div>
                )}
                <div className="min-w-0">
                  <SheetTitle className="truncate">{item.productName}</SheetTitle>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-neutral-500">{item.skuCode}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                        ITEM_TYPE_BADGE_CLASS[item.itemType]
                      )}
                    >
                      {getItemTypeBadgeText(item)}
                    </span>
                    <Badge variant={STOCK_STATUS_BADGE_VARIANT[item.stockStatus]}>
                      {STOCK_STATUS_LABELS[item.stockStatus]}
                    </Badge>
                  </div>
                </div>
              </div>
            </SheetHeader>

            <SheetBody className="space-y-5">
              <section>
                <h3 className="mb-1 text-xs font-bold tracking-wide text-neutral-400 uppercase">Stock</h3>
                <Field label="Available">{item.availableQuantity.toLocaleString("en-IN")} pcs</Field>
                <Field label="Reorder threshold">{item.lowStockThreshold.toLocaleString("en-IN")} pcs</Field>
                <Field label="Level">{formatStockRatio(item)}</Field>
              </section>

              <section>
                <h3 className="mb-1 text-xs font-bold tracking-wide text-neutral-400 uppercase">Details</h3>
                <Field label="Brand">{item.brandName ?? "—"}</Field>
                <Field label="Last updated">{formatDate(item.updatedAt)}</Field>
              </section>

              <section>
                <h3 className="mb-1 text-xs font-bold tracking-wide text-neutral-400 uppercase">Reference prices</h3>
                <Field label="Purchase price">{formatINR(item.purchasePrice)}</Field>
                <Field label="Selling price">{formatINR(item.sellingPrice)}</Field>
                <p className="mt-1 text-[11px] leading-relaxed text-neutral-400">
                  Read-only — these mirror the most recent purchase batch. Pricing is edited in Purchases.
                </p>
              </section>

              <section>
                <h3 className="mb-1 flex items-center gap-1.5 text-xs font-bold tracking-wide text-neutral-400 uppercase">
                  <History className="size-3.5" aria-hidden="true" />
                  Stock history
                </h3>
                <StockHistory itemId={item.id} />
              </section>
            </SheetBody>

            <SheetFooter>
              <Button type="button" className="w-full rounded-[10px]" onClick={() => onAdjustStock(item)}>
                <SlidersHorizontal className="size-4" />
                Adjust stock
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
