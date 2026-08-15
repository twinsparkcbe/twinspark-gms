"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Gift, Package, Search, Sparkles, Wrench } from "lucide-react";

import { Input } from "@/components/ui/input";
import { formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  isOutOfStock,
  quickPickEntries,
  resolveSelection,
  resolveTypedTerm,
  searchCatalog,
  type PickerEntry,
  type PickerResolution,
} from "@/services/service/picker";

/**
 * One search box for everything that can go on a Service Job (rework plan
 * Change 1).
 *
 * Replaces the old sequence — decide the line type, click the matching "Add"
 * button, get an empty row, open a flat dropdown, scroll — with: type, press
 * Enter. Packages, Specific Services and Inventory Items all resolve from the
 * same list, and the module works out what each one becomes. Text matching
 * nothing turns into a Custom line, so there's no dead end.
 *
 * The chip row above is the real everyday path: for a routine job the admin
 * taps two chips and never touches the keyboard.
 *
 * The results panel is rendered inline (absolutely positioned in a relative
 * wrapper) rather than through a portal — same convention as `Combobox`, for
 * the same reason documented there.
 */
export function ServiceLinePicker({
  entries,
  hasPackageLine,
  disabled,
  onResolve,
}: {
  entries: PickerEntry[];
  /** Enforces the 0-or-1 General Service Package rule (doc §4). */
  hasPackageLine: boolean;
  disabled?: boolean;
  /** Fired with whatever the admin picked or typed. The parent decides where
   * it lands — a service line or a Parts Used row. */
  onResolve: (resolution: PickerResolution) => void;
}) {
  const [term, setTerm] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => searchCatalog(entries, term), [entries, term]);
  const chips = useMemo(() => quickPickEntries(entries), [entries]);

  // Keeps the highlight on a row that still exists as results narrow.
  useEffect(() => setHighlight(0), [term]);

  useEffect(() => {
    if (!isOpen) return;
    function handlePointerDown(event: PointerEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setIsOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  /** Clears and refocuses on success, so several lines can be added in a row
   * without ever reaching for the mouse. */
  function emit(resolution: PickerResolution) {
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
      // A highlighted row wins; otherwise fall back to what was typed, which
      // resolves to an exact catalog match or a Custom line.
      emit(highlighted ? resolveSelection(highlighted, { hasPackageLine }) : resolveTypedTerm(entries, term, { hasPackageLine }));
      return;
    }
    if (event.key === "Escape") {
      setIsOpen(false);
    }
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
              disabled={disabled || (entry.kind === "PACKAGE" && hasPackageLine)}
              onClick={() => emit(resolveSelection(entry, { hasPackageLine }))}
              title={entry.kind === "PACKAGE" && hasPackageLine ? "Only one General Service Package per job" : undefined}
              className={cn(
                "flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                // A combo is a priced bundle, not another service — it needs
                // to read differently at a glance or it gets tapped by mistake.
                entry.kind === "COMBO"
                  ? "border-primary/40 bg-primary/5 text-primary hover:bg-primary/10"
                  : "border-neutral-200 text-neutral-700 hover:border-primary hover:text-primary disabled:hover:border-neutral-200 disabled:hover:text-neutral-700"
              )}
            >
              {entry.kind === "COMBO" && <Gift className="size-3.5" />}
              {entry.name}
              {entry.kind === "COMBO" && entry.rate !== null && <span className="font-semibold">· {formatINR(entry.rate)}</span>}
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
          placeholder="Add a service or part — type a name, or anything else and press Enter"
          className="h-10 rounded-[10px] pl-9"
          aria-label="Add a service or part"
          aria-expanded={showPanel}
          aria-controls="service-line-picker-results"
          role="combobox"
          onChange={(e) => {
            setTerm(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
        />

        {showPanel && (
          <div
            id="service-line-picker-results"
            className="absolute top-full left-0 z-50 mt-1 w-full rounded-[10px] border border-neutral-200 bg-white shadow-md"
          >
            <div className="max-h-72 overflow-y-auto p-1">
              {results.map((entry, i) => {
                const outOfStock = isOutOfStock(entry);
                const blocked = (entry.kind === "PACKAGE" && hasPackageLine) || outOfStock;

                return (
                  <button
                    key={entry.key}
                    type="button"
                    disabled={blocked}
                    aria-disabled={blocked}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => emit(resolveSelection(entry, { hasPackageLine }))}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm",
                      i === highlight && !blocked && "bg-neutral-100",
                      blocked && "cursor-not-allowed opacity-40"
                    )}
                  >
                    {entry.kind === "COMBO" ? (
                      <Gift className="size-4 shrink-0 text-primary" />
                    ) : entry.kind === "ITEM" ? (
                      <Package className="size-4 shrink-0 text-neutral-400" />
                    ) : (
                      <Wrench className="size-4 shrink-0 text-primary" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-neutral-900">{entry.name}</span>
                      <span className="block truncate text-xs text-neutral-500">
                        {entry.kind === "COMBO" && "Combo Offer · one fixed price"}
                        {entry.kind === "PACKAGE" && "General Service Package"}
                        {entry.kind === "SPECIFIC" && "Specific Service"}
                        {entry.kind === "ITEM" && (outOfStock ? "Part · out of stock" : `Part · ${entry.availableQuantity} in stock`)}
                        {entry.kind === "PACKAGE" && hasPackageLine && " · already on this job"}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-medium text-neutral-600">
                      {entry.rate === null ? "—" : formatINR(entry.rate)}
                    </span>
                  </button>
                );
              })}

              {/* Always offered, even alongside matches: the admin may mean
                  something the catalog doesn't have (doc §8). */}
              <button
                type="button"
                onClick={() => emit(resolveTypedTerm(entries, term, { hasPackageLine }))}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm",
                  results.length > 0 && "border-t border-neutral-100"
                )}
              >
                <Wrench className="size-4 shrink-0 text-neutral-400" />
                <span className="min-w-0 flex-1 truncate text-neutral-700">
                  Add <span className="font-medium text-neutral-900">&ldquo;{term.trim()}&rdquo;</span> as a custom line
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
