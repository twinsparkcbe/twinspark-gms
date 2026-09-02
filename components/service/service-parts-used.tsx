"use client";

import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ItemPickerCombobox } from "@/components/purchases/item-picker-combobox";
import { formatINR } from "@/lib/format";
import { maskAmountInput } from "@/lib/input-masks";
import { cn } from "@/lib/utils";
import type { InventoryItemRow } from "@/services/inventory";
import { effectivePartUnitPrice } from "@/services/service/totals";

export interface PartUsedDraft {
  id: string;
  inventoryItemId: string | null;
  quantityUsed: string;
  /** Negotiated price for this job only (0040), mirroring the Sales line
   * price. Empty string means "charge the catalogue price" — the meaning the
   * field had by its absence before it existed, so an untouched row behaves
   * exactly as before and nothing is sent to the server for it. */
  unitPrice?: string;
  /** Combo Offers — which combo brought this part in, if any. */
  comboId?: string | null;
  /** Bills at ₹0 because the combo price already covers it. Stock still moves. */
  includedInCombo?: boolean;
}

export type PartUsedErrors = Record<string, Record<string, string>>;

// `minmax(0,1fr)`, not `1fr`, for the description column. Every row is its
// own grid, and a bare `1fr` resolves to `minmax(auto,1fr)` — whose automatic
// minimum is the content's intrinsic width. A long item name therefore widened
// that one row's column, so rows disagreed with each other and with the
// header, and the trailing action buttons were pushed outside the card. A zero
// minimum makes the column purely a function of container width: identical in
// every row, and free to truncate.
// Below md the fixed tracks (436px + 60px of gaps) exceed a phone's width, so
// `minmax(0,1fr)` collapses to zero and the row overflows the card. Same
// two-column stack as components/sales/sale-line-items.tsx.
const ROW_GRID_CLASS =
  "grid grid-cols-[28px_minmax(0,1fr)] gap-x-3 gap-y-2 md:grid-cols-[28px_minmax(0,1fr)_120px_120px_120px_48px] md:gap-3";

/** Sits in its own column on desktop, stacks under the part name on mobile. */
const STACKED_CELL = "col-start-2 md:col-start-auto";

/**
 * Parts/consumables used on the job (doc §4/§9's Service Inventory Usage).
 *
 * Rows arrive from `ServiceLinePicker` — searching an inventory item lands
 * here automatically — or from a catalog entry's Default Items, so the old
 * "Add Part" button is gone (rework plan Change 1). The per-row combobox
 * stays, for swapping one item for another without deleting the row.
 *
 * Deliberately does NOT call adjust_stock: adding a row is pure data entry
 * while the job is Draft/In Progress; deduction happens exactly once,
 * atomically, at completion (doc §6/§7).
 *
 * The per-row "Only N in stock right now" hint stays advisory — a draft may
 * legitimately list a part that is on order. Billing is what gets blocked,
 * and that check lives in the form (services/service/stock-check.ts) because
 * it has to sum an item across rows: two rows of 2 against a stock of 3 is
 * short even though neither row is short on its own. When it fires, the
 * quantity field carries a red "Not enough stock." in place of this hint.
 */
export function ServicePartsUsed({
  parts,
  items,
  errors,
  disabled,
  onUpdate,
  onRemove,
}: {
  parts: PartUsedDraft[];
  items: InventoryItemRow[];
  errors: PartUsedErrors;
  disabled?: boolean;
  onUpdate: (id: string, patch: Partial<PartUsedDraft>) => void;
  onRemove: (id: string) => void;
}) {
  if (parts.length === 0) return null;

  return (
    <div role="table" aria-label="Parts used" className="rounded-[10px] border border-neutral-200">
      <div
        role="row"
        className={cn(
          ROW_GRID_CLASS,
          // Column headings mean nothing once the cells stack; each stacked
          // value carries its own inline label instead.
          "hidden rounded-t-[10px] border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase md:grid"
        )}
      >
        <span>#</span>
        <span>Part</span>
        <span>Quantity</span>
        <span className="text-right">Price</span>
        <span className="text-right">Amount</span>
        <span />
      </div>

      <div className="divide-y divide-neutral-200 bg-white">
        {parts.map((part, index) => {
          const partErrors = errors[part.id] ?? {};
          const selectedItem = items.find((i) => i.id === part.inventoryItemId) ?? null;
          const qty = Math.trunc(Number(part.quantityUsed) || 0);
          const included = part.includedInCombo === true;
          const amount = selectedItem && !included ? effectivePartUnitPrice(part, selectedItem.sellingPrice) * qty : 0;
          const exceedsStock = Boolean(selectedItem) && qty > (selectedItem?.availableQuantity ?? 0);

          return (
            <div key={part.id} role="row" className={cn(ROW_GRID_CLASS, "items-start px-3 py-2.5")}>
              <div className="flex h-9 items-center text-sm text-neutral-500">{index + 1}</div>

              <div>
                <ItemPickerCombobox
                  items={items}
                  value={part.inventoryItemId}
                  onChange={(itemId) => onUpdate(part.id, { inventoryItemId: itemId })}
                  hasError={Boolean(partErrors.inventoryItemId)}
                  disabled={disabled}
                />
                {partErrors.inventoryItemId && <p className="mt-1 text-xs text-danger">{partErrors.inventoryItemId}</p>}
              </div>

              <div className={STACKED_CELL}>
                <span className="mb-1 block text-xs text-neutral-400 md:hidden">Quantity</span>
                <Input
                  type="number"
                  min={1}
                  step="1"
                  inputMode="numeric"
                  aria-label="Quantity used"
                  value={part.quantityUsed}
                  disabled={disabled}
                  aria-invalid={Boolean(partErrors.quantityUsed) || undefined}
                  onChange={(e) => onUpdate(part.id, { quantityUsed: e.target.value })}
                  className="h-9 text-center"
                />
                {partErrors.quantityUsed ? (
                  <p className="mt-1 text-xs text-danger">{partErrors.quantityUsed}</p>
                ) : exceedsStock ? (
                  <p className="mt-1 text-xs text-warning">Only {selectedItem?.availableQuantity} in stock right now</p>
                ) : null}
              </div>

              {/* Editable at the counter, same as a Sale line: the price moves
                  for THIS JOB only. The catalogue is untouched — that still
                  comes from the newest purchase batch. Blank restores the
                  catalogue price. Below the item's cost is allowed here and
                  only warned about (confirmed 2026-09-02); the Sales-side
                  Administrator gate deliberately does not apply to a job. */}
              <div className={cn(STACKED_CELL, "flex flex-col justify-center md:items-end")}>
                {included ? (
                  <div className="flex h-9 items-center justify-between gap-2 md:justify-end">
                    <span className="text-xs text-neutral-400 md:hidden">Price</span>
                    <span className="rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-medium text-success">In combo</span>
                  </div>
                ) : selectedItem ? (
                  (() => {
                    const charged = effectivePartUnitPrice(part, selectedItem.sellingPrice);
                    const isOverridden = charged !== selectedItem.sellingPrice;
                    const belowCost = charged < selectedItem.purchasePrice;

                    return (
                      <>
                        <div className="flex h-9 w-full items-center justify-between gap-2 md:justify-end">
                          <span className="text-xs text-neutral-400 md:hidden">Price</span>
                          <div className="relative">
                            <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-xs text-neutral-400">
                              &#8377;
                            </span>
                            <input
                              inputMode="decimal"
                              aria-label={`Price for ${selectedItem.productName}`}
                              value={part.unitPrice ?? ""}
                              placeholder={String(selectedItem.sellingPrice)}
                              disabled={disabled}
                              onChange={(e) => onUpdate(part.id, { unitPrice: maskAmountInput(e.target.value) })}
                              className={cn(
                                "h-9 w-[104px] rounded-[8px] border bg-white pr-2 pl-5 text-right text-sm tabular-nums outline-none focus-visible:ring-2 disabled:bg-neutral-50",
                                belowCost
                                  ? "border-danger text-danger focus-visible:border-danger focus-visible:ring-danger/20"
                                  : isOverridden
                                    ? "border-warning text-neutral-900 focus-visible:border-warning focus-visible:ring-warning/20"
                                    : "border-neutral-200 text-neutral-600 focus-visible:border-brand-red focus-visible:ring-brand-red/20"
                              )}
                            />
                          </div>
                        </div>
                        {belowCost ? (
                          // The cost figure itself is deliberately not printed:
                          // this screen is a Mechanic's too, and a service total
                          // must never expose purchase price.
                          <p className="mt-0.5 text-right text-[11px] font-medium text-danger">
                            Below this item&rsquo;s cost price
                          </p>
                        ) : isOverridden ? (
                          // The list price stays on screen so whoever approves
                          // the bill can see what was given away.
                          <p className="mt-0.5 text-right text-[11px] text-neutral-500">
                            <span className="line-through">{formatINR(selectedItem.sellingPrice)}</span>{" "}
                            <span className={charged < selectedItem.sellingPrice ? "font-semibold text-warning" : "font-semibold text-success"}>
                              {charged < selectedItem.sellingPrice ? "−" : "+"}
                              {formatINR(Math.abs(selectedItem.sellingPrice - charged))}
                            </span>
                          </p>
                        ) : null}
                      </>
                    );
                  })()
                ) : (
                  <div className="flex h-9 items-center justify-between text-sm text-neutral-600 md:justify-end">
                    <span className="text-xs text-neutral-400 md:hidden">Price</span>—
                  </div>
                )}
              </div>
              <div
                className={cn(
                  STACKED_CELL,
                  "flex h-9 items-center justify-between text-sm font-semibold text-neutral-900 md:justify-end"
                )}
              >
                <span className="text-xs font-normal text-neutral-400 md:hidden">Amount</span>
                {formatINR(amount)}
              </div>

              <div className={cn(STACKED_CELL, "flex h-9 items-center justify-start md:justify-end")}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label="Remove part"
                  disabled={disabled}
                  onClick={() => onRemove(part.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
