"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/require-admin";
import { createClient } from "@/lib/supabase/server";
import {
  adjustInventoryStock,
  getInventoryStats,
  listAllInventoryItemsForExport,
  listInventoryItems,
  listReorderItems,
  listStockMovements,
  type InventoryItemFilters,
  type InventoryItemRow,
  type InventoryStats,
  type StockAdjustmentInput,
  type StockMovementRow,
} from "@/services/inventory";

// Item creation/editing, brands, and image upload all moved to
// app/(app)/purchases/actions.ts — Purchases is now the sole place
// inventory items are created and managed
// (doc/inventory-purchase-simplification-scope.md). Inventory only ever
// reads items and adjusts stock.

type ActionResult<T = undefined> = { success: true; data: T } | { success: false; error: string };

function toErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** Every action re-checks Admin access server-side — never trust the client. */
async function adminClient() {
  await requireAdmin();
  return createClient();
}

export async function fetchInventoryItemsAction(
  filters: InventoryItemFilters
): Promise<ActionResult<{ items: InventoryItemRow[]; total: number }>> {
  try {
    const supabase = await adminClient();
    const data = await listInventoryItems(supabase, filters);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load inventory.") };
  }
}

export async function adjustInventoryStockAction(input: StockAdjustmentInput): Promise<ActionResult> {
  try {
    const supabase = await adminClient();
    await adjustInventoryStock(supabase, input);
    revalidatePathBoth();
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to adjust stock.") };
  }
}

export async function fetchInventoryStatsAction(): Promise<ActionResult<InventoryStats>> {
  try {
    const supabase = await adminClient();
    const data = await getInventoryStats(supabase);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load inventory stats.") };
  }
}

/**
 * The reorder strip's data. Takes no filter argument on purpose — see
 * listReorderItems: the page's search box must not be able to narrow "what do
 * I need to buy".
 */
export async function fetchReorderItemsAction(): Promise<ActionResult<InventoryItemRow[]>> {
  try {
    const supabase = await adminClient();
    const data = await listReorderItems(supabase);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load reorder list.") };
  }
}

export async function fetchStockMovementsAction(
  inventoryItemId: string
): Promise<ActionResult<StockMovementRow[]>> {
  try {
    const supabase = await adminClient();
    const data = await listStockMovements(supabase, inventoryItemId);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load stock history.") };
  }
}

export async function exportInventoryItemsAction(
  filters: Pick<InventoryItemFilters, "search" | "itemTypes" | "brandIds" | "stockStatus">
): Promise<ActionResult<InventoryItemRow[]>> {
  try {
    const supabase = await adminClient();
    const data = await listAllInventoryItemsForExport(supabase, filters);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to export inventory.") };
  }
}

function revalidatePathBoth() {
  // Adjusting stock in Inventory also changes what Purchases' item picker
  // shows (available stock / reference price), so both pages revalidate.
  revalidatePath("/inventory");
  revalidatePath("/purchases");
}
