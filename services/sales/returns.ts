import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { InsufficientStockError, StockAdjustmentAuthError } from "@/services/shared/stock";
import type { Database } from "@/types/database.types";

import { saleReturnInputSchema, undoSaleReturnInputSchema, type SaleReturnInput, type UndoSaleReturnInput } from "./schemas";

/**
 * Covers record_sale_return()'s 22023 errors — in practice almost always
 * "requested quantity exceeds what's left on this line" or "only product
 * lines can be returned" (blank reason / non-positive quantity are already
 * caught client-side by Zod before the RPC is ever called). The DB's message
 * is specific enough to show directly.
 */
export class SaleReturnValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaleReturnValidationError";
  }
}

export class SaleItemNotFoundError extends Error {
  constructor(id: string) {
    super(`Sale item ${id} not found.`);
    this.name = "SaleItemNotFoundError";
  }
}

/** Thrown when the sale_returns row targeted by an undo no longer exists —
 * e.g. someone else already undid it a moment earlier. */
export class SaleReturnNotFoundError extends Error {
  constructor(id: string) {
    super(`Sale return ${id} not found.`);
    this.name = "SaleReturnNotFoundError";
  }
}

export interface SaleReturnRow {
  id: string;
  saleItemId: string;
  inventoryItemId: string;
  quantity: number;
  reason: string;
  createdAt: string;
}

type SaleReturnDbRow = {
  id: string;
  sale_item_id: string;
  inventory_item_id: string;
  quantity: number;
  reason: string;
  created_at: string;
};

const SELECT_COLUMNS = "id, sale_item_id, inventory_item_id, quantity, reason, created_at";

function mapRow(row: SaleReturnDbRow): SaleReturnRow {
  return {
    id: row.id,
    saleItemId: row.sale_item_id,
    inventoryItemId: row.inventory_item_id,
    quantity: row.quantity,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

export async function listReturnsForSaleItem(
  supabase: SupabaseClient<Database>,
  saleItemId: string
): Promise<SaleReturnRow[]> {
  const { data, error } = await supabase
    .from("sale_returns")
    .select(SELECT_COLUMNS)
    .eq("sale_item_id", saleItemId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return ((data ?? []) as SaleReturnDbRow[]).map(mapRow);
}

type SaleReturnWithSaleJoinRow = SaleReturnDbRow & {
  sale_items: { sale_id: string } | { sale_id: string }[] | null;
};

/**
 * Every existing return across a whole Sale (not just one line) — powers
 * the Return dialog's "existing returns, with Undo" list (doc/sales-module-
 * scope.md §6a). sale_returns has no sale_id column of its own, only
 * sale_item_id, so this filters through the sale_items join instead.
 */
export async function listReturnsForSale(
  supabase: SupabaseClient<Database>,
  saleId: string
): Promise<SaleReturnRow[]> {
  const { data, error } = await supabase
    .from("sale_returns")
    .select(`${SELECT_COLUMNS}, sale_items!inner(sale_id)`)
    .eq("sale_items.sale_id", saleId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as SaleReturnWithSaleJoinRow[]).map(mapRow);
}

/**
 * The only way to record a Sale Return — calls record_sale_return()
 * (0013_sales_schema.sql), which locks the source sale_items row, validates
 * the requested quantity against what's actually remaining, restocks via
 * the shared adjust_stock() path (reason SALE_RETURN, admin-only), and
 * inserts the sale_returns row, all atomically. Only PRODUCT lines are
 * returnable — an INSTALLATION line's charge is never touched by this.
 */
export async function recordSaleReturn(
  supabase: SupabaseClient<Database>,
  rawInput: SaleReturnInput
): Promise<SaleReturnRow> {
  const input = saleReturnInputSchema.parse(rawInput);

  const { data, error } = await supabase.rpc("record_sale_return", {
    p_sale_item_id: input.saleItemId,
    p_quantity: input.quantity,
    p_reason: input.reason,
  });

  if (error) {
    if (error.code === "P0001") {
      throw new InsufficientStockError("Not enough remaining stock on this line to reverse.");
    }
    if (error.code === "42501") {
      throw new StockAdjustmentAuthError("You don't have permission to record sale returns.");
    }
    if (error.code === "P0002") {
      throw new SaleItemNotFoundError(input.saleItemId);
    }
    if (error.code === "22023") {
      throw new SaleReturnValidationError(error.message);
    }
    throw new Error(error.message);
  }
  if (typeof data !== "string") {
    throw new Error("Unexpected response from record_sale_return.");
  }

  const { data: row, error: fetchError } = await supabase
    .from("sale_returns")
    .select(SELECT_COLUMNS)
    .eq("id", data)
    .maybeSingle();

  if (fetchError) throw new Error(fetchError.message);
  if (!row) throw new Error("Sale return was recorded but could not be re-fetched.");

  return mapRow(row as SaleReturnDbRow);
}

/**
 * Undo a Sale Return — calls undo_sale_return() (0015_undo_sale_return.sql),
 * which locks the sale_returns row, reverses the earlier restock via the
 * shared adjust_stock() path (reason SALE_RETURN, admin-only, same as
 * recording the return in the first place), and deletes the row, all
 * atomically. No return value — the caller refetches the sale/returns list
 * afterward, same pattern as recordSaleReturn's own callers already use.
 */
export async function undoSaleReturn(
  supabase: SupabaseClient<Database>,
  rawInput: UndoSaleReturnInput
): Promise<void> {
  const input = undoSaleReturnInputSchema.parse(rawInput);

  const { error } = await supabase.rpc("undo_sale_return", {
    p_sale_return_id: input.saleReturnId,
    p_reason: input.reason,
  });

  if (error) {
    if (error.code === "P0001") {
      throw new InsufficientStockError(
        "Can't undo — some of the returned stock has already been sold or used elsewhere."
      );
    }
    if (error.code === "42501") {
      throw new StockAdjustmentAuthError("You don't have permission to undo sale returns.");
    }
    if (error.code === "P0002") {
      throw new SaleReturnNotFoundError(input.saleReturnId);
    }
    if (error.code === "22023") {
      throw new SaleReturnValidationError(error.message);
    }
    throw new Error(error.message);
  }
}
