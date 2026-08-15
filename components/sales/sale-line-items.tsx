"use client";

import { useState } from "react";
import { Minus, Package, Pencil, Plus, ShoppingCart, Trash2, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
// Reused directly from Purchases (not duplicated) — flat search-by-name/SKU
// over active items covers Track Tyre, Brand New Tyre, and every other item
// type uniformly, same picker Record Purchase already uses.
import { ItemPickerCombobox } from "@/components/purchases/item-picker-combobox";
import { formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { InventoryItemRow } from "@/services/inventory";

export type LineDraft =
  | {
      id: string;
      lineType: "PRODUCT";
      inventoryItemId: string | null;
      quantity: string;
    }
  /**
   * A combo on a sale is one line and nothing more. Unlike Service — where
   * the job stays editable so the form has to hold the expanded contents —
   * a sale is recorded in one shot, so `record_sale()` expands the bundle
   * server-side from the id alone. The client can't mis-state what was in it
   * or skip a stock deduction. Everything below is display only.
   */
  | {
      id: string;
      lineType: "COMBO";
      comboId: string;
      comboName: string;
      comboPrice: string;
      comboContents: string[];
      /** Drives the double-charge warning when a fitting line is also added. */
      comboCoversFitting: boolean;
      quantity: string;
    }
  | {
      id: string;
      lineType: "INSTALLATION";
      installationSubtype: "TYRE_FITTING" | "CUSTOM" | null;
      wheelCount: string;
      description: string;
      amount: string;
      installedBy: string;
    };

export type LineErrors = Record<string, Record<string, string>>;

const TYRE_FITTING_RATE = 300;

// SL No | Description | Quantity | Unit Price | Amount | Action — same six
// invoice-style columns for every line, product or installation, so the
// list reads as one table. Price and Amount are both right-aligned so the
// two number columns sit at a consistent rhythm instead of Price hugging
// the left while Amount jumps to the far right.
// `minmax(0,1fr)`, not `1fr`, for the description column. Every row is its
// own grid, and a bare `1fr` resolves to `minmax(auto,1fr)` — whose automatic
// minimum is the content's intrinsic width. A long item name therefore widened
// that one row's column, so rows disagreed with each other and with the
// header, and the trailing action buttons were pushed outside the card. A zero
// minimum makes the column purely a function of container width: identical in
// every row, and free to truncate.
// Below md those six tracks don't fit: 482px of fixed columns plus 60px of
// gaps needs ~570px of container before the description column gets any width
// at all. Narrower than that and `minmax(0,1fr)` correctly collapses to zero —
// the item name shreds to one word per line and the fixed tracks overflow the
// card, which is what the header colliding into "ITEMUANTITY" was.
//
// So below md the row becomes two columns — the line number, and everything
// else stacked beneath the item name (see STACKED_CELL).
const ROW_GRID_CLASS =
  "grid grid-cols-[28px_minmax(0,1fr)] gap-x-3 gap-y-2 md:grid-cols-[28px_minmax(0,1fr)_170px_100px_120px_64px] md:gap-3";

/** Cells that sit in their own column on desktop and stack under the item
 * name on mobile, indented past the line number so the block reads as one
 * record rather than a ragged list. */
const STACKED_CELL = "col-start-2 md:col-start-auto";

function lineTotal(line: LineDraft, items: InventoryItemRow[]): number {
  if (line.lineType === "COMBO") {
    return (Number(line.comboPrice) || 0) * Math.trunc(Number(line.quantity) || 0);
  }
  if (line.lineType === "PRODUCT") {
    const item = items.find((i) => i.id === line.inventoryItemId);
    const qty = Math.trunc(Number(line.quantity) || 0);
    return item ? item.sellingPrice * qty : 0;
  }
  if (line.installationSubtype === "TYRE_FITTING") {
    const override = Number(line.amount);
    if (line.amount.trim() !== "" && !Number.isNaN(override)) return override;
    const wheels = Math.trunc(Number(line.wheelCount) || 0);
    return wheels * TYRE_FITTING_RATE;
  }
  return Number(line.amount) || 0;
}

/** −/[value]/+ stepper, clamped at a minimum of 1 — used for both product
 * quantity and tyre-fitting wheel count. When `max` is given (available
 * stock for a PRODUCT line), neither the + button nor typing can push the
 * value past it — typing a number over stock snaps straight back down to
 * max, same as clicking + repeatedly would stop there. */
function QuantityStepper({
  value,
  onChange,
  disabled,
  hasError,
  max,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  hasError?: boolean;
  max?: number;
}) {
  const numeric = Math.trunc(Number(value) || 0);
  return (
    <div className="flex items-center gap-1.5">
      <Button
        type="button"
        variant="secondary"
        size="icon"
        className="size-8 shrink-0"
        aria-label="Decrease"
        disabled={disabled || numeric <= 1}
        onClick={() => onChange(String(Math.max(1, numeric - 1)))}
      >
        <Minus className="size-3.5" />
      </Button>
      <Input
        type="number"
        min={1}
        max={max}
        step="1"
        inputMode="numeric"
        value={value}
        disabled={disabled}
        aria-invalid={hasError || undefined}
        onChange={(e) => {
          const raw = e.target.value;
          if (max !== undefined && raw !== "") {
            const n = Math.trunc(Number(raw) || 0);
            if (n > max) {
              onChange(String(max));
              return;
            }
          }
          onChange(raw);
        }}
        // Native number-input spin arrows fight the custom −/+ buttons for
        // the same narrow space and squash the digit — suppressed here since
        // this stepper is the only up/down control that should show.
        className="h-8 w-20 px-1 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <Button
        type="button"
        variant="secondary"
        size="icon"
        className="size-8 shrink-0"
        aria-label="Increase"
        disabled={disabled || (max !== undefined && numeric >= max)}
        onClick={() => onChange(String(max !== undefined ? Math.min(max, numeric + 1) : numeric + 1))}
      >
        <Plus className="size-3.5" />
      </Button>
    </div>
  );
}

export function SaleLineItems({
  lines,
  items,
  errors,
  disabled,
  onUpdate,
  onRemove,
}: {
  lines: LineDraft[];
  items: InventoryItemRow[];
  errors: LineErrors;
  disabled?: boolean;
  onUpdate: (id: string, patch: Partial<LineDraft>) => void;
  onRemove: (id: string) => void;
}) {
  // Purely local UI state — which lines are showing their picker/edit form
  // rather than the compact summary row. A PRODUCT line always shows the
  // picker while no item is chosen yet; picking one collapses it to a
  // summary row automatically. The pencil action re-opens it.
  const [editingIds, setEditingIds] = useState<Set<string>>(new Set());

  function setEditing(id: string, isEditing: boolean) {
    setEditingIds((prev) => {
      const next = new Set(prev);
      if (isEditing) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <div className="space-y-3">

      {lines.length === 0 ? (
        <p className="rounded-[10px] border border-dashed border-neutral-200 px-4 py-6 text-center text-sm text-neutral-500">
          Nothing added yet — search above, or tap a quick-add chip.
        </p>
      ) : (
        // No overflow-x-auto/overflow-hidden here on purpose — either one
        // clips the item picker's dropdown, which is an absolutely
        // positioned popover (not portal-based, see item-picker-combobox.tsx)
        // and needs to escape this container to be visible when a row is
        // near the table's edge. Rounded corners come from the header row's
        // own rounded-t instead of a clipping wrapper.
        <div role="table" aria-label="Sale items" className="rounded-[10px] border border-neutral-200">
          <div
            role="row"
            className={cn(
              ROW_GRID_CLASS,
              // Hidden on mobile: column headings mean nothing once the cells
              // stack, and each stacked value carries its own inline label.
              "hidden rounded-t-[10px] border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase md:grid"
            )}
          >
              <span>#</span>
              <span>Item</span>
              <span>Quantity</span>
              <span className="text-right">Price</span>
              <span className="text-right">Amount</span>
              <span />
            </div>

            <div className="divide-y divide-neutral-200 bg-white">
              {lines.map((line, index) => {
                const lineErrors = errors[line.id] ?? {};
                const total = lineTotal(line, items);
                const isEditing = editingIds.has(line.id);

                if (line.lineType === "PRODUCT") {
                  const selectedItem = items.find((i) => i.id === line.inventoryItemId) ?? null;
                  const showPicker = !line.inventoryItemId || isEditing;

                  return (
                    <div key={line.id} role="row" className={cn(ROW_GRID_CLASS, "items-start px-3 py-2.5")}>
                      <div className="flex h-9 items-center text-sm text-neutral-500">{index + 1}</div>

                      {showPicker ? (
                        <div>
                          <ItemPickerCombobox
                            items={items}
                            value={line.inventoryItemId}
                            onChange={(itemId) => {
                              onUpdate(line.id, { inventoryItemId: itemId });
                              setEditing(line.id, false);
                            }}
                            hasError={Boolean(lineErrors.inventoryItemId)}
                            disabled={disabled}
                          />
                          {lineErrors.inventoryItemId && (
                            <p className="mt-1 text-xs text-danger">{lineErrors.inventoryItemId}</p>
                          )}
                        </div>
                      ) : (
                        <div className="flex min-w-0 items-center gap-2 py-0.5">
                          <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-neutral-100">
                            {selectedItem?.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element -- small inline thumbnail, not worth next/image's overhead here
                              <img src={selectedItem.imageUrl} alt="" className="size-full object-cover" />
                            ) : (
                              <Package className="size-4 text-neutral-400" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-neutral-900">
                              {selectedItem?.productName ?? "—"}
                            </p>
                            <p className="truncate text-xs text-neutral-500">{selectedItem?.skuCode}</p>
                          </div>
                        </div>
                      )}

                      <div className={STACKED_CELL}>
                        {showPicker ? (
                          // Spacer only exists to hold the desktop column's
                          // height; on mobile it would be blank vertical space.
                          <div className="hidden h-9 md:block" />
                        ) : (
                          <>
                            {(() => {
                              const qtyNum = Math.trunc(Number(line.quantity) || 0);
                              const exceedsStock = Boolean(selectedItem) && qtyNum > (selectedItem?.availableQuantity ?? 0);
                              return (
                                <>
                                  <QuantityStepper
                                    value={line.quantity}
                                    onChange={(v) => onUpdate(line.id, { quantity: v })}
                                    disabled={disabled}
                                    hasError={Boolean(lineErrors.quantity) || exceedsStock}
                                    max={selectedItem?.availableQuantity}
                                  />
                                  {lineErrors.quantity ? (
                                    <p className="mt-1 text-xs text-danger">{lineErrors.quantity}</p>
                                  ) : exceedsStock ? (
                                    <p className="mt-1 text-xs text-danger">
                                      Only {selectedItem?.availableQuantity} in stock
                                    </p>
                                  ) : selectedItem ? (
                                    <p className="mt-1 text-xs text-neutral-400">{selectedItem.availableQuantity} available</p>
                                  ) : null}
                                </>
                              );
                            })()}
                          </>
                        )}
                      </div>

                      {/* Stacked, these are bare numbers with no column heading
                          above them, so each carries its own mobile-only label. */}
                      <div
                        className={cn(
                          STACKED_CELL,
                          "flex h-9 items-center justify-between text-sm text-neutral-600 md:justify-end"
                        )}
                      >
                        <span className="text-xs text-neutral-400 md:hidden">Price</span>
                        {selectedItem ? formatINR(selectedItem.sellingPrice) : "—"}
                      </div>
                      <div
                        className={cn(
                          STACKED_CELL,
                          "flex h-9 items-center justify-between text-sm font-semibold text-neutral-900 md:justify-end"
                        )}
                      >
                        <span className="text-xs font-normal text-neutral-400 md:hidden">Amount</span>
                        {formatINR(total)}
                      </div>
                      <div className={cn(STACKED_CELL, "flex h-9 items-center justify-start gap-0.5 md:justify-end")}>
                        {!showPicker && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label="Edit item"
                            disabled={disabled}
                            onClick={() => setEditing(line.id, true)}
                          >
                            <Pencil className="size-4" />
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label="Remove line"
                          disabled={disabled}
                          onClick={() => onRemove(line.id)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  );
                }

                if (line.lineType === "COMBO") {
                  return (
                    <div key={line.id} role="row" className={cn(ROW_GRID_CLASS, "items-start bg-primary/5 px-3 py-2.5")}>
                      <div className="flex h-9 items-center text-sm text-neutral-500">{index + 1}</div>

                      <div className="min-w-0">
                        <div className="flex min-h-9 flex-col justify-center">
                          <span className="truncate text-sm font-semibold text-neutral-900">{line.comboName}</span>
                          <span className="text-[11px] font-medium text-primary">Combo Offer · one fixed price</span>
                          {/* Contents unpriced — a second set of numbers here
                              would contradict the single combo price. */}
                          {line.comboContents.length > 0 && (
                            <ul className="mt-1 space-y-0.5">
                              {line.comboContents.map((content, i) => (
                                <li key={`${line.id}-c-${i}`} className="truncate text-[11px] text-neutral-500">
                                  · {content}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>

                      <div className={STACKED_CELL}>
                        <QuantityStepper
                          value={line.quantity}
                          disabled={disabled}
                          onChange={(value) => onUpdate(line.id, { quantity: value })}
                        />
                      </div>

                      <div
                        className={cn(
                          STACKED_CELL,
                          "flex h-9 items-center justify-between text-sm text-neutral-600 md:justify-end"
                        )}
                      >
                        <span className="text-xs text-neutral-400 md:hidden">Price</span>
                        {formatINR(Number(line.comboPrice) || 0)}
                      </div>
                      <div
                        className={cn(
                          STACKED_CELL,
                          "flex h-9 items-center justify-between text-sm font-semibold text-neutral-900 md:justify-end"
                        )}
                      >
                        <span className="text-xs font-normal text-neutral-400 md:hidden">Amount</span>
                        {formatINR(lineTotal(line, items))}
                      </div>

                      <div className={cn(STACKED_CELL, "flex h-9 items-center justify-start md:justify-end")}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label="Remove combo"
                          disabled={disabled}
                          onClick={() => onRemove(line.id)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={line.id} role="row" className="bg-neutral-50/60 px-3 py-2.5">
                    {/* Full-width label above the grid so the value columns
                        (quantity/price/amount) line up with the Select box
                        below it instead of with this heading. */}
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
                      <Wrench className="size-3.5" />
                      Installation Charge
                    </div>
                    <div className={cn(ROW_GRID_CLASS, "items-start")}>
                    <div className="flex h-9 items-center text-sm text-neutral-500">{index + 1}</div>

                    <div className="min-w-0 space-y-1.5">
                      {/* Once it's a custom/"Other Installation" charge (whether
                          typed straight into the picker or picked from the
                          Select below), the type is already decided and staff
                          rarely record who installed a one-off charge — so the
                          row simplifies to just the typed description, no
                          Select and no "Installed By" (matches Tyre Fitting's
                          own decision to keep both, since that one IS tracked
                          per-mechanic). To change a CUSTOM line's type, remove
                          and re-add it — there's no way back to the Select
                          once installationSubtype is CUSTOM. */}
                      {line.installationSubtype === "CUSTOM" ? (
                        <div>
                          <Input
                            placeholder="e.g. Chain Sprocket Kit Installation"
                            value={line.description}
                            disabled={disabled}
                            aria-invalid={Boolean(lineErrors.description) || undefined}
                            onChange={(e) => onUpdate(line.id, { description: e.target.value })}
                            className="h-9"
                          />
                          {lineErrors.description && (
                            <p className="mt-1 text-xs text-danger">{lineErrors.description}</p>
                          )}
                        </div>
                      ) : (
                        <>
                          <Select
                            value={line.installationSubtype ?? undefined}
                            onValueChange={(value) =>
                              onUpdate(line.id, { installationSubtype: value as "TYRE_FITTING" | "CUSTOM" })
                            }
                            disabled={disabled}
                          >
                            <SelectTrigger size="sm" className="w-full rounded-[10px]">
                              <SelectValue placeholder="Select fitting type" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="TYRE_FITTING">Tyre Fitting (₹300/wheel)</SelectItem>
                              <SelectItem value="CUSTOM">Other Installation</SelectItem>
                            </SelectContent>
                          </Select>
                          {lineErrors.installationSubtype && (
                            <p className="text-xs text-danger">{lineErrors.installationSubtype}</p>
                          )}
                        </>
                      )}

                      {line.installationSubtype === "TYRE_FITTING" && (
                        <Input
                          placeholder="Installed By (staff name)"
                          value={line.installedBy}
                          disabled={disabled}
                          onChange={(e) => onUpdate(line.id, { installedBy: e.target.value })}
                          className="h-9"
                        />
                      )}
                    </div>

                    <div className={STACKED_CELL}>
                      {line.installationSubtype === "TYRE_FITTING" ? (
                        <>
                          <QuantityStepper
                            value={line.wheelCount}
                            onChange={(v) => onUpdate(line.id, { wheelCount: v })}
                            disabled={disabled}
                            hasError={Boolean(lineErrors.wheelCount)}
                          />
                          {lineErrors.wheelCount && <p className="mt-1 text-xs text-danger">{lineErrors.wheelCount}</p>}
                        </>
                      ) : (
                        <div className="hidden h-9 items-center text-sm text-neutral-400 md:flex">—</div>
                      )}
                    </div>

                    <div
                      className={cn(
                        STACKED_CELL,
                        "flex h-9 items-center justify-between text-sm text-neutral-600 md:justify-end"
                      )}
                    >
                      <span className="text-xs text-neutral-400 md:hidden">Rate</span>
                      {line.installationSubtype === "TYRE_FITTING" ? `${formatINR(TYRE_FITTING_RATE)}/wheel` : "—"}
                    </div>

                    <div className={STACKED_CELL}>
                      {line.installationSubtype === "TYRE_FITTING" ? (
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          className="h-9 text-right"
                          placeholder={formatINR(Math.trunc(Number(line.wheelCount) || 0) * TYRE_FITTING_RATE)}
                          value={line.amount}
                          disabled={disabled}
                          onChange={(e) => onUpdate(line.id, { amount: e.target.value })}
                        />
                      ) : (
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          className="h-9 text-right"
                          placeholder="e.g. 250"
                          value={line.amount}
                          disabled={disabled}
                          aria-invalid={Boolean(lineErrors.amount) || undefined}
                          onChange={(e) => onUpdate(line.id, { amount: e.target.value })}
                        />
                      )}
                      {lineErrors.amount && <p className="mt-1 text-xs text-danger">{lineErrors.amount}</p>}
                      <p className="mt-1 text-right text-xs font-semibold text-neutral-900">= {formatINR(total)}</p>
                    </div>

                    <div className={cn(STACKED_CELL, "flex h-9 items-center justify-start md:justify-end")}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label="Remove line"
                        disabled={disabled}
                        onClick={() => onRemove(line.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
      )}
    </div>
  );
}

export { lineTotal, TYRE_FITTING_RATE };
