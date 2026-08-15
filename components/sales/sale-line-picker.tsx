"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Package, Search, Sparkles, Wrench } from "lucide-react";

import { Input } from "@/components/ui/input";
import { formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  isSaleEntryOutOfStock,
  resolveSaleSelection,
  resolveSaleTypedTerm,
  saleQuickPickEntries,
  searchSaleCatalog,
  type SalePickerEntry,
  type SalePickerResolution,
} from "@/services/sales/picker";

/**
 * One search box for everything that can go on a sale (sales rework §4.A).
 *
 * The Sales twin of `ServiceLinePicker` — same interaction, same keyboard
 * rules, same inline (non-portal) results panel, so the two screens feel
 * identical. Deliberately a sibling rather than one shared component: the
 * vocabularies differ (products/fitting here, packages/services/parts/combos
 * there), and collapsing them would produce a props union where half the
 * options are invalid on each screen.
 *
 * Replaces the old *Add Product* / *Add Installation Charge* pair. Typing
 * something the catalog doesn't have and pressing Enter becomes a one-off
 * charge, so there's no dead end.
 */
export function SaleLinePicker({
  entries,
  suggestedWheelCount,
  disabled,
  onResolve,
}: {
  entries: SalePickerEntry[];
  /** Tyres already on the sale — pre-fills the wheel count when fitting is
   * picked, so the usual case needs no typing. */
  suggestedWheelCount: number;
  disabled?: boolean;
  onResolve: (resolution: SalePickerResolution) => void;
}) {
  const [term, setTerm] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => searchSaleCatalog(entries, term), [entries, term]);
  const chips = useMemo(() => saleQuickPickEntries(entries), [entries]);

  useEffect(() => setHighlight(0), [term]);

  useEffect(() => {
    if (!isOpen) return;
    function handlePointerDown(event: PointerEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setIsOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  /** Clears and refocuses on success, so a multi-item sale never needs the
   * mouse between lines. */
  function emit(resolution: SalePickerResolution) {
    onResolve(resolution);
    if (resolution.ok) {
      setTerm("");
      setIsOpen(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIsOpen(true);
      setHighlight((prev) => (results.length === 0 ? 0 : (prev + 1) % results.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((prev) => (results.length === 0 ? 0 : (prev - 1 + results.length) % results.length));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const highlighted = results[highlight];
      emit(
        highlighted
          ? resolveSaleSelection(highlighted, { suggestedWheelCount })
          : resolveSaleTypedTerm(entries, term, { suggestedWheelCount })
      );
      return;
    }
    if (event.key === "Escape") setIsOpen(false);
  }

  const showPanel = isOpen && term.trim().length > 0;

  return (
    <div className="space-y-2.5">
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="flex items-center gap-1 text-xs font-medium text-neutral-400">
            <Sparkles className="size-3.5" />
            Quick add
          </span>
          {chips.map((entry) => (
            <button
              key={entry.key}
              type="button"
              disabled={disabled}
              onClick={() => emit(resolveSaleSelection(entry, { suggestedWheelCount }))}
              className="flex items-center gap-1 rounded-full border border-neutral-200 px-3 py-1 text-xs font-medium text-neutral-700 transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              {entry.name}
            </button>
          ))}
        </div>
      )}

      <div ref={wrapperRef} className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-neutral-400" />
        <Input
          ref={inputRef}
          value={term}
          disabled={disabled}
          placeholder="Add an item or charge — type a name or SKU, or anything else and press Enter"
          className="h-10 rounded-[10px] pl-9"
          aria-label="Add an item or charge"
          aria-expanded={showPanel}
          aria-controls="sale-line-picker-results"
          role="combobox"
          onChange={(e) => {
            setTerm(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
        />

        {showPanel && (
          <div id="sale-line-picker-results" className="absolute top-full left-0 z-50 mt-1 w-full rounded-[10px] border border-neutral-200 bg-white shadow-md">
            <div className="max-h-72 overflow-y-auto p-1">
              {results.map((entry, i) => {
                const outOfStock = isSaleEntryOutOfStock(entry);

                return (
                  <button
                    key={entry.key}
                    type="button"
                    disabled={outOfStock}
                    aria-disabled={outOfStock}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => emit(resolveSaleSelection(entry, { suggestedWheelCount }))}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm",
                      i === highlight && !outOfStock && "bg-neutral-100",
                      outOfStock && "cursor-not-allowed opacity-40"
                    )}
                  >
                    {entry.kind === "FITTING" ? (
                      <Wrench className="size-4 shrink-0 text-primary" />
                    ) : (
                      <Package className="size-4 shrink-0 text-neutral-400" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-neutral-900">{entry.name}</span>
                      <span className={cn("block truncate text-xs", outOfStock ? "text-danger" : "text-neutral-500")}>
                        {entry.kind === "FITTING" && `Installation · ${formatINR(entry.rate ?? 0)} per wheel`}
                        {entry.kind === "ITEM" && (outOfStock ? "Out of stock" : `${entry.availableQuantity} in stock · ${entry.skuCode}`)}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-medium text-neutral-600">{entry.rate === null ? "—" : formatINR(entry.rate)}</span>
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => emit(resolveSaleTypedTerm(entries, term, { suggestedWheelCount }))}
                className={cn("flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm", results.length > 0 && "border-t border-neutral-100")}
              >
                <Wrench className="size-4 shrink-0 text-neutral-400" />
                <span className="min-w-0 flex-1 truncate text-neutral-700">
                  Charge <span className="font-medium text-neutral-900">&ldquo;{term.trim()}&rdquo;</span> as a one-off
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
