import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getInventoryItem,
  type InventoryItemRow,
} from "@/services/inventory/items";
import {
  InsufficientStockError,
  StockAdjustmentAuthError,
  StockAdjustmentValidationError,
} from "@/services/shared/stock";
import type { Database } from "@/types/database.types";

import { newItemWithPurchaseInputSchema, type NewItemWithPurchaseInput } from "./schemas";

/** Raised when create_inventory_item_with_purchase() hits a duplicate SKU/name (23505). */
export class DuplicateInventoryItemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateInventoryItemError";
  }
}

function rethrowIfDuplicate(error: { code?: string; message: string }): never {
  if (error.code === "23505") {
    if (error.message.includes("sku_code")) {
      throw new DuplicateInventoryItemError("An item with this SKU / Code already exists.");
    }
    throw new DuplicateInventoryItemError(
      "An active item with this name already exists for this type/brand."
    );
  }
  throw new Error(error.message);
}

/**
 * "New Item" mode of Record Purchase — creates the item and its opening
 * batch atomically via create_inventory_item_with_purchase()
 * (0011_purchases_item_ownership.sql), the only way an inventory item gets
 * created now (doc/inventory-purchase-simplification-scope.md §1.1). Never
 * called directly for Track Tyre when an active one already exists — the
 * caller (RecordPurchaseDialog) detects that via getActiveTrackTyreItem()
 * and calls recordPurchaseEntry() against the existing item instead (same
 * singleton behavior as the old Add Item flow).
 */
export async function createInventoryItemWithPurchase(
  supabase: SupabaseClient<Database>,
  rawInput: NewItemWithPurchaseInput
): Promise<InventoryItemRow> {
  const input = newItemWithPurchaseInputSchema.parse(rawInput);

  const { data, error } = await supabase.rpc("create_inventory_item_with_purchase", {
    p_item_type: input.itemType,
    p_product_name: input.productName,
    p_sku_code: input.skuCode?.trim() || null,
    p_brand_id: input.brandId,
    p_low_stock_threshold: input.lowStockThreshold,
    p_custom_type_label: input.itemType === "OTHER_SPARE_PART" ? (input.customTypeLabel?.trim() ?? null) : null,
    p_image_url: input.imageUrl ?? null,
    p_quantity: input.quantity,
    p_unit_price: input.unitPrice,
    p_selling_price: input.sellingPrice,
    p_purchase_date: input.purchaseDate.toISOString(),
    p_supplier_name: input.supplierName ?? null,
    p_note: input.note ?? null,
  });

  if (error) {
    if (error.code === "23505") rethrowIfDuplicate(error);
    if (error.code === "P0001") {
      throw new InsufficientStockError("Not enough stock available for this adjustment.");
    }
    if (error.code === "42501") {
      throw new StockAdjustmentAuthError("You don't have permission to create inventory items.");
    }
    if (error.code === "22023") {
      throw new StockAdjustmentValidationError(error.message);
    }
    throw new Error(error.message);
  }
  if (typeof data !== "string") {
    throw new Error("Unexpected response from create_inventory_item_with_purchase.");
  }

  return getInventoryItem(supabase, data);
}
