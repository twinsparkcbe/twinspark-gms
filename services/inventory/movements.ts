import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, StockMovementReason } from "@/types/database.types";

/**
 * A single entry in an item's stock history, for the Inventory detail drawer.
 *
 * The `stock_movements` table has existed since 0001 and is already read by
 * COGS and the profit report — it just never surfaced in the UI, which left
 * "why is this count wrong?" unanswerable without database access
 * (doc/inventory-redesign-scope.md §3f).
 */
export interface StockMovementRow {
  id: string;
  /** Signed: negative for stock leaving, positive for stock arriving. */
  delta: number;
  resultingBalance: number;
  reason: StockMovementReason;
  /** Which module wrote the movement, e.g. "purchases" / "sales". */
  sourceModule: string;
  note: string | null;
  createdAt: string;
}

type StockMovementDbRow = {
  id: string;
  delta: number;
  resulting_balance: number;
  reason: StockMovementReason;
  source_module: string;
  note: string | null;
  created_at: string;
};

const DEFAULT_MOVEMENT_LIMIT = 20;

/**
 * Newest first, capped — the drawer shows recent history, not an audit log.
 * `stock_movements_item_idx` is already on `(inventory_item_id, created_at
 * desc)`, so this is an index-only walk and needs no migration.
 */
export async function listStockMovements(
  supabase: SupabaseClient<Database>,
  inventoryItemId: string,
  limit: number = DEFAULT_MOVEMENT_LIMIT
): Promise<StockMovementRow[]> {
  const { data, error } = await supabase
    .from("stock_movements")
    .select("id, delta, resulting_balance, reason, source_module, note, created_at")
    .eq("inventory_item_id", inventoryItemId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as StockMovementDbRow[]).map((row) => ({
    id: row.id,
    delta: row.delta,
    resultingBalance: row.resulting_balance,
    reason: row.reason,
    sourceModule: row.source_module,
    note: row.note,
    createdAt: row.created_at,
  }));
}
