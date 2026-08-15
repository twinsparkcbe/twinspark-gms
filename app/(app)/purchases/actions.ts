"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/require-admin";
import { createClient } from "@/lib/supabase/server";
import type { ItemType } from "@/types/database.types";
import {
  createBrand,
  deactivateInventoryItem,
  deleteInventoryItem,
  getActiveTrackTyreItem,
  getInventoryItem,
  InventoryItemHasHistoryError,
  listAllInventoryItemsForExport,
  listCustomTypeLabels,
  updateInventoryItemDetails,
  uploadInventoryItemImage,
  type BrandRow,
  type InventoryItemRow,
  type ItemDetailsInput,
} from "@/services/inventory";
import {
  createInventoryItemWithPurchase,
  getLatestPurchaseSupplier,
  getPurchaseStats,
  listPurchaseEntries,
  listReturnsForEntry,
  recordPurchaseEntry,
  recordPurchaseReturn,
  updatePurchaseEntry,
  type NewItemWithPurchaseInput,
  type PurchaseEntryEditInput,
  type PurchaseEntryFilters,
  type PurchaseEntryInput,
  type PurchaseEntryRow,
  type PurchaseReturnInput,
  type PurchaseReturnRow,
  type PurchaseStats,
} from "@/services/purchases";

type ActionResult<T = undefined> = { success: true; data: T } | { success: false; error: string };

function toErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** Every action re-checks Admin access server-side — never trust the client
 * (Purchase Management is Admin-only, same as Inventory — spec §6). */
async function adminClient() {
  await requireAdmin();
  return createClient();
}

function revalidateBoth() {
  revalidatePath("/purchases");
  revalidatePath("/inventory"); // stock, reference prices, or item details just changed
}

export async function fetchPurchaseEntriesAction(
  filters: PurchaseEntryFilters
): Promise<ActionResult<{ entries: PurchaseEntryRow[]; total: number }>> {
  try {
    const supabase = await adminClient();
    const data = await listPurchaseEntries(supabase, filters);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load purchase history.") };
  }
}

export async function recordPurchaseEntryAction(
  input: PurchaseEntryInput
): Promise<ActionResult<PurchaseEntryRow>> {
  try {
    const supabase = await adminClient();
    const data = await recordPurchaseEntry(supabase, input);
    revalidateBoth();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to record purchase.") };
  }
}

/**
 * "New Item" mode of Record Purchase — creates the item and its opening
 * batch atomically (doc/inventory-purchase-simplification-scope.md §1.1).
 */
export async function createInventoryItemWithPurchaseAction(
  input: NewItemWithPurchaseInput
): Promise<ActionResult<InventoryItemRow>> {
  try {
    const supabase = await adminClient();
    const data = await createInventoryItemWithPurchase(supabase, input);
    revalidateBoth();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to create item.") };
  }
}

// Lets the New Item form detect an existing Track Tyre Front/Back singleton
// (scoped to the exact derived product name for whichever position was
// picked) before creating a new row — see getActiveTrackTyreItem() in
// services/inventory.
export async function fetchActiveTrackTyreItemAction(
  productName: string
): Promise<ActionResult<InventoryItemRow | null>> {
  try {
    const supabase = await adminClient();
    const data = await getActiveTrackTyreItem(supabase, productName);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to check for an existing Track Tyre item.") };
  }
}

// Powers Edit Item Details — fetched fresh by id rather than reused from an
// already-loaded list, so it's correct even for an item that's since been
// deactivated (and so wouldn't appear in the active-only item picker list).
export async function fetchInventoryItemByIdAction(id: string): Promise<ActionResult<InventoryItemRow>> {
  try {
    const supabase = await adminClient();
    const data = await getInventoryItem(supabase, id);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load item.") };
  }
}

export async function updateInventoryItemDetailsAction(
  id: string,
  input: ItemDetailsInput
): Promise<ActionResult<InventoryItemRow>> {
  try {
    const supabase = await adminClient();
    const data = await updateInventoryItemDetails(supabase, id, input);
    revalidateBoth();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to save item.") };
  }
}

/**
 * Deletes the item if it has no history; if the DB blocks the delete because
 * of existing purchase/sale/service history, falls back to deactivating it
 * instead so the action always succeeds one way or another.
 */
export async function deleteOrDeactivateInventoryItemAction(
  id: string
): Promise<ActionResult<{ action: "deleted" | "deactivated" }>> {
  try {
    const supabase = await adminClient();

    try {
      await deleteInventoryItem(supabase, id);
      revalidateBoth();
      return { success: true, data: { action: "deleted" } };
    } catch (err) {
      if (!(err instanceof InventoryItemHasHistoryError)) throw err;

      await deactivateInventoryItem(supabase, id);
      revalidateBoth();
      return { success: true, data: { action: "deactivated" } };
    }
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to remove item.") };
  }
}

export async function uploadInventoryImageAction(formData: FormData): Promise<ActionResult<{ url: string }>> {
  try {
    const supabase = await adminClient();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return { success: false, error: "No file provided." };
    }
    const url = await uploadInventoryItemImage(supabase, file);
    return { success: true, data: { url } };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to upload image.") };
  }
}

// Powers both the Type filter's extra options (Inventory) and the New Item /
// Edit Item Details forms' "Specify Type" suggestions.
export async function fetchCustomTypeLabelsAction(): Promise<ActionResult<string[]>> {
  try {
    const supabase = await adminClient();
    const data = await listCustomTypeLabels(supabase);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load custom types.") };
  }
}

export async function createBrandAction(
  name: string,
  itemType: ItemType
): Promise<ActionResult<BrandRow>> {
  try {
    const supabase = await adminClient();
    const data = await createBrand(supabase, { name, itemType });
    revalidateBoth();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to create brand.") };
  }
}

export async function fetchPurchaseStatsAction(range?: {
  from?: string;
  to?: string;
  search?: string;
  itemTypes?: ItemType[];
  brandIds?: string[];
}): Promise<ActionResult<PurchaseStats>> {
  try {
    const supabase = await adminClient();
    const data = await getPurchaseStats(
      supabase,
      range
        ? {
            from: range.from ? new Date(range.from) : undefined,
            to: range.to ? new Date(range.to) : undefined,
            search: range.search,
            itemTypes: range.itemTypes,
            brandIds: range.brandIds,
          }
        : undefined
    );
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load purchase stats.") };
  }
}

export async function recordPurchaseReturnAction(
  input: PurchaseReturnInput
): Promise<ActionResult<PurchaseReturnRow>> {
  try {
    const supabase = await adminClient();
    const data = await recordPurchaseReturn(supabase, input);
    revalidateBoth();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to record purchase return.") };
  }
}

/**
 * Corrects a data-entry mistake on an already-recorded batch. Any batch can
 * be edited at any time (confirmed decision) — reducing quantity below
 * what's already been sold/returned from it is still rejected server-side.
 */
export async function updatePurchaseEntryAction(
  entryId: string,
  input: PurchaseEntryEditInput
): Promise<ActionResult<PurchaseEntryRow>> {
  try {
    const supabase = await adminClient();
    const data = await updatePurchaseEntry(supabase, entryId, input);
    revalidateBoth();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to save purchase.") };
  }
}

export async function fetchReturnsForEntryAction(
  purchaseEntryId: string
): Promise<ActionResult<PurchaseReturnRow[]>> {
  try {
    const supabase = await adminClient();
    const data = await listReturnsForEntry(supabase, purchaseEntryId);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load returns for this purchase.") };
  }
}

// Powers Record Purchase's "Existing Item" supplier prefill — fired when the
// item picker selection changes, alongside the synchronous price prefill
// from the already-loaded InventoryItemRow.
export async function fetchLatestPurchaseSupplierAction(inventoryItemId: string): Promise<ActionResult<string | null>> {
  try {
    const supabase = await adminClient();
    const data = await getLatestPurchaseSupplier(supabase, inventoryItemId);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load last supplier.") };
  }
}

// Powers the Record Purchase item picker — reuses Inventory's existing
// unpaginated active-items query (services/inventory/items.ts) rather than
// duplicating a second "list active items" function here.
export async function fetchActiveItemsForPickerAction(): Promise<ActionResult<InventoryItemRow[]>> {
  try {
    const supabase = await adminClient();
    const data = await listAllInventoryItemsForExport(supabase, {});
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load items.") };
  }
}
