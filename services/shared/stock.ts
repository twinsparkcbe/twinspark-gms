import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, StockMovementReason } from "@/types/database.types";

/**
 * Shared stock-adjustment logic — the single place that increments/decrements
 * inventory quantities. Called by Purchases (increase), Sales/Service
 * (decrease), and Online Orders (decrease, dispatch only). Do not duplicate
 * stock math inside individual module services — everything goes through
 * `adjustStock()`, which calls the `adjust_stock()` Postgres function
 * (supabase/migrations/0001_inventory_schema.sql). That function is the only
 * thing allowed to write `inventory_items.available_quantity`; it's also
 * where negative-stock prevention and reason-based authorization live, so
 * both are race-safe and enforced even against direct API calls, not just
 * enforced in this TypeScript layer.
 */

export class InsufficientStockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientStockError";
  }
}

export class StockAdjustmentAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StockAdjustmentAuthError";
  }
}

export class StockAdjustmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StockAdjustmentValidationError";
  }
}

export interface AdjustStockInput {
  itemId: string;
  /** Positive to increase stock, negative to decrease. */
  delta: number;
  reason: StockMovementReason;
  /** Which module triggered this, e.g. "inventory", "purchases", "sales". */
  sourceModule: string;
  /** Required by the DB function for MANUAL_CORRECTION, DAMAGE, and PURCHASE_RETURN. */
  note?: string;
  /**
   * Targets one specific batch instead of generic FIFO — used for a
   * PURCHASE increase (the caller already created the batch) or a
   * PURCHASE_RETURN decrease (always targets the batch being returned
   * against). Omit for FIFO consumption (Sale/Service/Damage/etc.) or to
   * let an increase create its own synthetic batch (Opening Stock/Manual
   * Correction — see unitCost below).
   */
  purchaseEntryId?: string;
  /**
   * Cost for a synthetic batch when delta > 0 and purchaseEntryId is
   * omitted (Opening Stock / a positive Manual Correction). Falls back to
   * the item's most recent batch cost in the DB function if left unset.
   */
  unitCost?: number;
}

/**
 * Adjusts an inventory item's stock and logs the movement, atomically.
 * Throws a typed error on insufficient stock, missing authorization, or a
 * missing required note — callers should catch these specifically to show
 * the right message rather than a generic failure toast.
 */
export async function adjustStock(
  supabase: SupabaseClient<Database>,
  input: AdjustStockInput
): Promise<number> {
  if (input.delta === 0) {
    throw new StockAdjustmentValidationError("Adjustment quantity cannot be zero.");
  }

  const { data, error } = await supabase.rpc("adjust_stock", {
    p_item_id: input.itemId,
    p_delta: input.delta,
    p_reason: input.reason,
    p_source_module: input.sourceModule,
    p_note: input.note ?? null,
    p_purchase_entry_id: input.purchaseEntryId ?? null,
    p_unit_cost: input.unitCost ?? null,
  });

  if (error) {
    if (error.code === "P0001") {
      throw new InsufficientStockError(
        "Not enough stock available for this adjustment."
      );
    }
    if (error.code === "42501") {
      throw new StockAdjustmentAuthError(
        "You don't have permission to record this type of stock movement."
      );
    }
    if (error.code === "22023") {
      throw new StockAdjustmentValidationError(
        "A note is required for manual corrections and damage write-offs."
      );
    }
    throw new Error(error.message);
  }

  if (typeof data !== "number") {
    throw new Error("Unexpected response from adjust_stock.");
  }

  return data;
}
