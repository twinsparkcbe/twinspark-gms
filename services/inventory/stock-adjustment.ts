import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { adjustStock } from "@/services/shared/stock";
import type { Database, StockMovementReason } from "@/types/database.types";

import { stockAdjustmentInputSchema, type StockAdjustmentInput } from "./schemas";

/**
 * Maps the Inventory module's 7 "Adjust Stock" reason labels
 * (doc/inventory-purchase-simplification-scope.md §2.2) down to the DB's 2
 * relevant stock_movement_reason enum values — no DB enum change needed,
 * since DAMAGE and MANUAL_CORRECTION already get identical treatment in
 * adjust_stock() (both admin-only, both note-required). The label itself
 * carries the specific meaning in the audit trail:
 *   - Damaged, Manufacturing Defect, Lost/Missing → DAMAGE (stock is gone,
 *     not recoverable).
 *   - Customer Return, Supplier Return, Manual Correction, Other →
 *     MANUAL_CORRECTION (a correction/adjustment, not a write-off).
 */
function toMovementReason(reasonLabel: StockAdjustmentInput["reasonLabel"]): StockMovementReason {
  if (reasonLabel === "Damaged" || reasonLabel === "Manufacturing Defect" || reasonLabel === "Lost/Missing") {
    return "DAMAGE";
  }
  return "MANUAL_CORRECTION";
}

/**
 * Builds the text actually logged on the stock movement. "Other" uses the
 * user's own customReason as the label instead of the literal word "Other",
 * so the audit trail shows what it really was. Note is optional, so the
 * label stands alone when there's nothing to append.
 */
function toLoggedNote(input: StockAdjustmentInput): string {
  const label =
    input.reasonLabel === "Other" && input.customReason ? input.customReason.trim() : input.reasonLabel;
  const note = input.note?.trim();
  return note ? `${label}: ${note}` : label;
}

export async function adjustInventoryStock(
  supabase: SupabaseClient<Database>,
  rawInput: StockAdjustmentInput
): Promise<number> {
  const input = stockAdjustmentInputSchema.parse(rawInput);

  return adjustStock(supabase, {
    itemId: input.itemId,
    delta: input.delta,
    reason: toMovementReason(input.reasonLabel),
    sourceModule: "inventory",
    note: toLoggedNote(input),
    // Only meaningful for a positive delta (see schemas.ts) — creates a
    // synthetic batch at this cost (or the item's last batch cost if
    // omitted) so every unit of stock always has a real cost behind it.
    unitCost: input.unitCost,
  });
}
