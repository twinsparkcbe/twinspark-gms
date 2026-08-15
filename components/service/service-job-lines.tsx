"use client";

import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import { serviceLineAmount as computeLineAmount } from "@/services/service/totals";

export interface ServiceLineDraft {
  id: string;
  lineType: "PACKAGE" | "SPECIFIC" | "CUSTOM" | "COMBO";
  generalServicePackageId: string | null;
  specificServiceId: string | null;
  /** Combo Offers — set only on a COMBO line. */
  comboId: string | null;
  /** What the combo contains, printed unpriced beneath the line. */
  comboContents: string[];
  description: string;
  quantity: string;
  rate: string;
}

export type ServiceLineErrors = Record<string, Record<string, string>>;

// `minmax(0,1fr)`, not `1fr`, for the description column. Every row is its
// own grid, and a bare `1fr` resolves to `minmax(auto,1fr)` — whose automatic
// minimum is the content's intrinsic width. A long item name therefore widened
// that one row's column, so rows disagreed with each other and with the
// header, and the trailing action buttons were pushed outside the card. A zero
// minimum makes the column purely a function of container width: identical in
// every row, and free to truncate.
// Below md the fixed tracks (406px + 60px of gaps) are wider than a phone, so
// `minmax(0,1fr)` collapses to zero and the description shreds to one word per
// line while the rest overflows the card. Same two-column stack as
// components/sales/sale-line-items.tsx.
const ROW_GRID_CLASS =
  "grid grid-cols-[28px_minmax(0,1fr)] gap-x-3 gap-y-2 md:grid-cols-[28px_minmax(0,1fr)_90px_120px_120px_48px] md:gap-3";

/** Sits in its own column on desktop, stacks under the description on mobile. */
const STACKED_CELL = "col-start-2 md:col-start-auto";

const LINE_TYPE_LABELS: Record<ServiceLineDraft["lineType"], string> = {
  PACKAGE: "General Service",
  SPECIFIC: "Specific Service",
  CUSTOM: "Custom",
  COMBO: "Combo Offer",
};

/** Re-exported so existing callers keep one import site for the line maths;
 * the implementation now lives in the shared, unit-tested totals module. */
export function serviceLineAmount(line: ServiceLineDraft): number {
  return computeLineAmount(line);
}

/**
 * The service lines already on the job (doc §4/§9).
 *
 * Adding is no longer this component's job — `ServiceLinePicker` above it
 * handles that in one keystroke (rework plan Change 1), which is why the
 * three "Add …" buttons and the per-row catalog dropdowns are gone. A
 * catalog line now shows its snapshotted description as plain text with a
 * kind tag; only Custom lines keep an editable description, since that text
 * is the only record of what was done.
 */
export function ServiceJobLines({
  lines,
  errors,
  disabled,
  onUpdate,
  onRemove,
}: {
  lines: ServiceLineDraft[];
  errors: ServiceLineErrors;
  disabled?: boolean;
  onUpdate: (id: string, patch: Partial<ServiceLineDraft>) => void;
  onRemove: (id: string) => void;
}) {
  if (lines.length === 0) {
    return (
      <p className="rounded-[10px] border border-dashed border-neutral-200 px-4 py-6 text-center text-sm text-neutral-500">
        Nothing added yet — search above, or tap a quick-add chip. A job can be saved with none of this decided.
      </p>
    );
  }

  return (
    <div role="table" aria-label="Service lines" className="rounded-[10px] border border-neutral-200">
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
        <span>Service</span>
        <span>Qty</span>
        <span className="text-right">Rate</span>
        <span className="text-right">Amount</span>
        <span />
      </div>

      <div className="divide-y divide-neutral-200 bg-white">
        {lines.map((line, index) => {
          const lineErrors = errors[line.id] ?? {};

          return (
            <div key={line.id} role="row" className={cn(ROW_GRID_CLASS, "items-start px-3 py-2.5")}>
              <div className="flex h-9 items-center text-sm text-neutral-500">{index + 1}</div>

              <div className="min-w-0">
                {line.lineType === "CUSTOM" ? (
                  <>
                    <Input
                      placeholder="e.g. Fork Seal Replacement"
                      value={line.description}
                      disabled={disabled}
                      aria-invalid={Boolean(lineErrors.description) || undefined}
                      onChange={(e) => onUpdate(line.id, { description: e.target.value })}
                      className="h-9"
                    />
                    {lineErrors.description && <p className="mt-1 text-xs text-danger">{lineErrors.description}</p>}
                  </>
                ) : (
                  <div className="flex min-h-9 flex-col justify-center">
                    <span className="truncate text-sm font-medium text-neutral-900">{line.description}</span>
                    <span className="truncate text-[11px] text-neutral-400">{LINE_TYPE_LABELS[line.lineType]}</span>
                    {/* A combo bills as one price, so its contents are listed
                        here unpriced — the customer sees what they got
                        without a second set of numbers contradicting it. */}
                    {line.lineType === "COMBO" && line.comboContents.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {line.comboContents.map((content, i) => (
                          <li key={`${line.id}-content-${i}`} className="truncate text-[11px] text-neutral-500">
                            · {content}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              {/* Stacked, these inputs lose their column headings, so each
                  gets a mobile-only label above it. */}
              <div className={STACKED_CELL}>
                <span className="mb-1 block text-xs text-neutral-400 md:hidden">Qty</span>
                <Input
                  type="number"
                  min={1}
                  step="1"
                  inputMode="numeric"
                  aria-label="Quantity"
                  value={line.quantity}
                  disabled={disabled}
                  onChange={(e) => onUpdate(line.id, { quantity: e.target.value })}
                  className="h-9 text-center"
                />
              </div>

              <div className={STACKED_CELL}>
                <span className="mb-1 block text-xs text-neutral-400 md:hidden">Rate</span>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  aria-label="Rate"
                  value={line.rate}
                  disabled={disabled}
                  aria-invalid={Boolean(lineErrors.rate) || undefined}
                  onChange={(e) => onUpdate(line.id, { rate: e.target.value })}
                  className="h-9 text-right"
                />
                {lineErrors.rate && <p className="mt-1 text-xs text-danger">{lineErrors.rate}</p>}
              </div>

              <div
                className={cn(
                  STACKED_CELL,
                  "flex h-9 items-center justify-between text-sm font-semibold text-neutral-900 md:justify-end"
                )}
              >
                <span className="text-xs font-normal text-neutral-400 md:hidden">Amount</span>
                {formatINR(serviceLineAmount(line))}
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
          );
        })}
      </div>
    </div>
  );
}
