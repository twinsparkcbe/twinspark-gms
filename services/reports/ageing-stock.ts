import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, ItemType } from "@/types/database.types";

export interface AgeingStockRow {
  inventoryItemId: string;
  itemName: string;
  itemSkuCode: string;
  itemType: ItemType;
  customTypeLabel: string | null;
  brandName: string | null;
  /** purchase_date of the oldest batch still carrying stock (remaining_quantity > 0) — not created_at. */
  oldestBatchDate: string;
  /** How much of that specific oldest batch hasn't sold yet. */
  remainingQuantity: number;
  /** That batch's own unit cost, so you can see how much cash is tied up. */
  unitPrice: number;
}

type JoinedItem = {
  product_name: string;
  sku_code: string;
  item_type: ItemType;
  custom_type_label: string | null;
  brands: { name: string } | { name: string }[] | null;
};

type PurchaseEntryRow = {
  inventory_item_id: string;
  remaining_quantity: number;
  unit_price: number;
  purchase_date: string;
  inventory_items: JoinedItem | JoinedItem[] | null;
};

function firstOrSelf<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function monthsAgo(now: Date, months: number): Date {
  const d = new Date(now);
  d.setMonth(d.getMonth() - months);
  return d;
}

/**
 * Shelf-time flag (doc/reports-scope.md §6), not a manufacturer's printed
 * expiry date — nothing tracks that today. Reuses `purchase_entries`'
 * existing FIFO columns (`purchase_date`, `remaining_quantity`, already in
 * place for 0010_purchase_batch_fifo.sql) rather than adding a new column
 * and a manual data-entry burden at every purchase.
 *
 * "Oldest unsold batch per item, older than the threshold" — fetches every
 * batch that still has stock (there are only ever a handful per item, so
 * this is a small result set), keeps the oldest one seen per item (the
 * query is already ordered oldest-first, so the first row per item wins),
 * then filters to ones older than `monthsThreshold`. A batch with
 * `remaining_quantity = 0` (fully sold through) is excluded at the query
 * level, no matter how old — nothing to flag, it's not tying up cash.
 */
export async function listAgeingStock(
  supabase: SupabaseClient<Database>,
  monthsThreshold: number,
  now: Date = new Date()
): Promise<AgeingStockRow[]> {
  const { data, error } = await supabase
    .from("purchase_entries")
    .select(
      "inventory_item_id, remaining_quantity, unit_price, purchase_date, inventory_items!inner(product_name, sku_code, item_type, custom_type_label, brand_id, brands(name))"
    )
    .gt("remaining_quantity", 0)
    .order("purchase_date", { ascending: true });

  if (error) throw new Error(error.message);

  const cutoff = monthsAgo(now, monthsThreshold);
  const oldestPerItem = new Map<string, AgeingStockRow>();

  for (const row of (data ?? []) as unknown as PurchaseEntryRow[]) {
    if (oldestPerItem.has(row.inventory_item_id)) continue; // already have the (earlier-seen, i.e. older) batch for this item

    const item = firstOrSelf(row.inventory_items);
    oldestPerItem.set(row.inventory_item_id, {
      inventoryItemId: row.inventory_item_id,
      itemName: item?.product_name ?? "Deleted item",
      itemSkuCode: item?.sku_code ?? "—",
      itemType: item?.item_type ?? "OTHER_SPARE_PART",
      customTypeLabel: item?.custom_type_label ?? null,
      brandName: item ? (firstOrSelf(item.brands)?.name ?? null) : null,
      oldestBatchDate: row.purchase_date,
      remainingQuantity: row.remaining_quantity,
      unitPrice: Number(row.unit_price),
    });
  }

  return [...oldestPerItem.values()]
    .filter((row) => new Date(row.oldestBatchDate).getTime() <= cutoff.getTime())
    .sort((a, b) => new Date(a.oldestBatchDate).getTime() - new Date(b.oldestBatchDate).getTime());
}
