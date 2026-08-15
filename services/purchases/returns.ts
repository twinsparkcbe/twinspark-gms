import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { InsufficientStockError, StockAdjustmentAuthError } from "@/services/shared/stock";
import type { Database } from "@/types/database.types";

import { PurchaseEntryNotFoundError } from "./entries";
import { purchaseReturnInputSchema, type PurchaseReturnInput } from "./schemas";

/**
 * Covers the DB's 22023 errors from record_purchase_return() — in practice
 * almost always "requested quantity exceeds what's left on this purchase"
 * (quantity <= 0 / blank reason are already caught client-side by Zod
 * before the RPC is ever called). The DB's message is specific enough
 * ("Cannot return X units — only Y remaining...") to show directly.
 */
export class PurchaseReturnValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PurchaseReturnValidationError";
  }
}

export interface PurchaseReturnRow {
  id: string;
  purchaseEntryId: string;
  inventoryItemId: string;
  quantity: number;
  reason: string;
  createdAt: string;
}

type PurchaseReturnDbRow = {
  id: string;
  purchase_entry_id: string;
  inventory_item_id: string;
  quantity: number;
  reason: string;
  created_at: string;
};

function mapRow(row: PurchaseReturnDbRow): PurchaseReturnRow {
  return {
    id: row.id,
    purchaseEntryId: row.purchase_entry_id,
    inventoryItemId: row.inventory_item_id,
    quantity: row.quantity,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

const SELECT_COLUMNS = "id, purchase_entry_id, inventory_item_id, quantity, reason, created_at";

export async function listReturnsForEntry(
  supabase: SupabaseClient<Database>,
  purchaseEntryId: string
): Promise<PurchaseReturnRow[]> {
  const { data, error } = await supabase
    .from("purchase_returns")
    .select(SELECT_COLUMNS)
    .eq("purchase_entry_id", purchaseEntryId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return ((data ?? []) as PurchaseReturnDbRow[]).map(mapRow);
}

/**
 * The only way to record a Purchase Return — calls record_purchase_return()
 * (0009_purchase_schema.sql), which locks the source purchase_entries row,
 * validates the requested quantity against what's actually remaining,
 * decreases stock via the shared adjust_stock() path, and inserts the
 * purchase_returns row, all atomically.
 */
export async function recordPurchaseReturn(
  supabase: SupabaseClient<Database>,
  rawInput: PurchaseReturnInput
): Promise<PurchaseReturnRow> {
  const input = purchaseReturnInputSchema.parse(rawInput);

  const { data, error } = await supabase.rpc("record_purchase_return", {
    p_purchase_entry_id: input.purchaseEntryId,
    p_quantity: input.quantity,
    p_reason: input.reason,
  });

  if (error) {
    if (error.code === "P0001") {
      throw new InsufficientStockError("Not enough stock available for this return.");
    }
    if (error.code === "42501") {
      throw new StockAdjustmentAuthError("You don't have permission to record purchase returns.");
    }
    if (error.code === "P0002") {
      throw new PurchaseEntryNotFoundError(input.purchaseEntryId);
    }
    if (error.code === "22023") {
      throw new PurchaseReturnValidationError(error.message);
    }
    throw new Error(error.message);
  }
  if (typeof data !== "string") {
    throw new Error("Unexpected response from record_purchase_return.");
  }

  const { data: row, error: fetchError } = await supabase
    .from("purchase_returns")
    .select(SELECT_COLUMNS)
    .eq("id", data)
    .maybeSingle();

  if (fetchError) throw new Error(fetchError.message);
  if (!row) throw new Error("Purchase return was recorded but could not be re-fetched.");

  return mapRow(row as PurchaseReturnDbRow);
}
