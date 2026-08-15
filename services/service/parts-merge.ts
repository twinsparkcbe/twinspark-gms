/**
 * Merging a catalog entry's Default Items into the job's Parts Used list
 * (doc/service-module-scope.md §3 Revision 3; rework plan §D).
 *
 * Extracted from `service-job-form-client.tsx` unchanged in behaviour — it
 * now matters more, because the unified picker (rework Change 1) fires this
 * on every catalog pick rather than only on a dropdown selection.
 *
 * Semantics, unchanged and deliberate:
 * - Same item already on the list → quantities stack, no duplicate row.
 * - One-way only: removing the package line later does NOT retract the parts
 *   it added. Tracking provenance per line was judged not worth the
 *   complexity; staff delete what they don't need.
 */

import type { CatalogDefaultItemRow } from "./catalog";

export interface MergeablePart {
  id: string;
  inventoryItemId: string | null;
  quantityUsed: string;
}

/**
 * Returns a new parts array with `defaultItems` folded in. Pure — never
 * mutates the input, so it drops straight into a React state updater.
 *
 * @param newId Injected id factory (crypto.randomUUID in the browser) so the
 *   function stays deterministic under test.
 */
export function mergeDefaultItemsIntoParts(
  parts: MergeablePart[],
  defaultItems: CatalogDefaultItemRow[],
  newId: () => string
): MergeablePart[] {
  if (defaultItems.length === 0) return parts;

  const next = [...parts];

  for (const item of defaultItems) {
    const existingIndex = next.findIndex((p) => p.inventoryItemId === item.inventoryItemId);

    if (existingIndex >= 0) {
      const existing = next[existingIndex];
      const currentQty = Math.trunc(Number(existing.quantityUsed) || 0);
      next[existingIndex] = { ...existing, quantityUsed: String(currentQty + item.defaultQuantity) };
    } else {
      next.push({ id: newId(), inventoryItemId: item.inventoryItemId, quantityUsed: String(item.defaultQuantity) });
    }
  }

  return next;
}
