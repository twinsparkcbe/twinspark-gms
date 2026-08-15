import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, ItemType } from "@/types/database.types";

import {
  itemDetailsInputSchema,
  type InventoryItemFilters,
  type InventoryItemSort,
  type ItemDetailsInput,
} from "./schemas";

export class InventoryItemNotFoundError extends Error {
  constructor(id: string) {
    super(`Inventory item ${id} not found.`);
    this.name = "InventoryItemNotFoundError";
  }
}

export class DuplicateInventoryItemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateInventoryItemError";
  }
}

export class InventoryItemHasHistoryError extends Error {
  constructor() {
    super(
      "This item has purchase, sale, or service history and can't be deleted — deactivate it instead."
    );
    this.name = "InventoryItemHasHistoryError";
  }
}

export type StockStatus = "in_stock" | "low_stock" | "out_of_stock";

export interface InventoryItemRow {
  id: string;
  itemType: ItemType;
  productName: string;
  skuCode: string;
  brandId: string | null;
  brandName: string | null;
  purchasePrice: number;
  sellingPrice: number;
  availableQuantity: number;
  lowStockThreshold: number;
  stockStatus: StockStatus;
  isActive: boolean;
  updatedAt: string;
  imageUrl: string | null;
  /** Only set (and only meaningful) when itemType is OTHER_SPARE_PART. */
  customTypeLabel: string | null;
}

export interface InventoryStats {
  totalProducts: number;
  lowStock: number;
  outOfStock: number;
  /** Cost-basis valuation: sum(purchase_price * available_quantity) over active items. */
  inventoryValueCost: number;
}

// Exported so services/dashboard/stats.ts can reuse the exact same
// column list + mapping for its Low Stock Alerts query, rather than
// re-deriving InventoryItemRow shaping logic a second time.
export type InventoryItemJoinedRow = {
  id: string;
  item_type: ItemType;
  product_name: string;
  sku_code: string;
  brand_id: string | null;
  purchase_price: number;
  selling_price: number;
  available_quantity: number;
  low_stock_threshold: number;
  stock_status: StockStatus;
  is_active: boolean;
  updated_at: string;
  image_url: string | null;
  custom_type_label: string | null;
  brands: { name: string } | { name: string }[] | null;
};

function firstOrSelf<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function mapRow(row: InventoryItemJoinedRow): InventoryItemRow {
  return {
    id: row.id,
    itemType: row.item_type,
    productName: row.product_name,
    skuCode: row.sku_code,
    brandId: row.brand_id,
    brandName: firstOrSelf(row.brands)?.name ?? null,
    purchasePrice: Number(row.purchase_price),
    sellingPrice: Number(row.selling_price),
    availableQuantity: row.available_quantity,
    lowStockThreshold: row.low_stock_threshold,
    stockStatus: row.stock_status,
    isActive: row.is_active,
    updatedAt: row.updated_at,
    imageUrl: row.image_url,
    customTypeLabel: row.custom_type_label,
  };
}

export const SELECT_COLUMNS =
  "id, item_type, product_name, sku_code, brand_id, purchase_price, selling_price, available_quantity, low_stock_threshold, stock_status, is_active, updated_at, image_url, custom_type_label, brands(name)";

function applyFilters<T>(
  query: T,
  filters: Pick<InventoryItemFilters, "search" | "itemTypes" | "brandIds" | "stockStatus">
): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = query as any;
  if (filters.search) {
    // Match product name, SKU, or the custom "Other Spare Part" label (e.g.
    // "Seat Cover") — the label is the only place that free-text lives for
    // custom types, so search must cover it. Commas/parens in the term would
    // break PostgREST's or() syntax; escape by stripping them (search is a
    // fuzzy ilike anyway, so dropping a stray comma is harmless).
    const term = filters.search.replace(/[,()]/g, " ").trim();
    if (term) {
      q = q.or(
        `product_name.ilike.%${term}%,sku_code.ilike.%${term}%,custom_type_label.ilike.%${term}%`
      );
    }
  }
  // Multi-select filters use IN (match-ANY). An empty/omitted array applies
  // no constraint. A single-element array behaves like the old eq filter.
  if (filters.itemTypes?.length) q = q.in("item_type", filters.itemTypes);
  if (filters.brandIds?.length) q = q.in("brand_id", filters.brandIds);
  if (filters.stockStatus) q = q.eq("stock_status", filters.stockStatus);
  return q as T;
}

/**
 * Ordering that puts the items needing action at the top.
 *
 * `stock_status` is a generated **text** column, not an enum
 * (0001_inventory_schema.sql), so ordering it descending is plain reverse
 * alphabetical — which happens to be exactly urgency order:
 *
 *     out_of_stock  >  low_stock  >  in_stock
 *
 * That is a coincidence of how the three statuses were named, not a designed
 * ordering. Renaming any status could silently invert the entire default view,
 * so items.test.ts asserts the string comparison directly as a tripwire.
 *
 * Within a status group, lowest quantity first (most urgent of the urgent),
 * then name for a stable, predictable order.
 */
function applyUrgencySort<T>(query: T): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = query as any;
  return q
    .order("stock_status", { ascending: false })
    .order("available_quantity", { ascending: true })
    .order("product_name", { ascending: true }) as T;
}

/** Maps the UI's sort dropdown to a concrete order-by clause. Defaults to
 * "urgency" when omitted (callers that don't care about sort, e.g. export). */
function applySort<T>(query: T, sortBy: InventoryItemSort | undefined): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = query as any;
  switch (sortBy ?? "urgency") {
    case "newest":
      return q.order("created_at", { ascending: false }) as T;
    case "stock":
      return q.order("available_quantity", { ascending: true }) as T;
    case "name":
      return q.order("product_name", { ascending: true }) as T;
    case "urgency":
    default:
      return applyUrgencySort(q) as T;
  }
}

/**
 * Items the owner needs to restock, for the Inventory screen's reorder strip.
 *
 * Deliberately takes **no filter argument**. "What do I need to buy" is not a
 * question the page's search box should be able to narrow — typing a product
 * name to look something up shouldn't make the reorder list appear to empty
 * out (doc/inventory-redesign-scope.md §3c).
 */
const DEFAULT_REORDER_LIMIT = 6;

export async function listReorderItems(
  supabase: SupabaseClient<Database>,
  limit: number = DEFAULT_REORDER_LIMIT
): Promise<InventoryItemRow[]> {
  const { data, error } = await applyUrgencySort(
    supabase.from("inventory_items").select(SELECT_COLUMNS).eq("is_active", true)
  )
    .in("stock_status", ["out_of_stock", "low_stock"])
    .limit(limit);

  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as InventoryItemJoinedRow[]).map(mapRow);
}

export async function listInventoryItems(
  supabase: SupabaseClient<Database>,
  filters: InventoryItemFilters
): Promise<{ items: InventoryItemRow[]; total: number }> {
  const from = (filters.page - 1) * filters.pageSize;
  const to = from + filters.pageSize - 1;

  const baseQuery = applySort(
    supabase.from("inventory_items").select(SELECT_COLUMNS, { count: "exact" }).eq("is_active", true),
    filters.sortBy
  ).range(from, to);

  const { data, error, count } = await applyFilters(baseQuery, filters);
  if (error) throw new Error(error.message);

  return {
    items: ((data ?? []) as unknown as InventoryItemJoinedRow[]).map(mapRow),
    total: count ?? 0,
  };
}

/**
 * Fetches every active item matching the given filters, unpaginated, for
 * CSV export. Capped at EXPORT_LIMIT rows — plenty for a single-garage
 * catalog, and keeps a mistyped/empty filter from ever pulling the whole
 * table into memory.
 */
const EXPORT_LIMIT = 5000;

export async function listAllInventoryItemsForExport(
  supabase: SupabaseClient<Database>,
  filters: Pick<InventoryItemFilters, "search" | "itemTypes" | "brandIds" | "stockStatus">
): Promise<InventoryItemRow[]> {
  const baseQuery = supabase
    .from("inventory_items")
    .select(SELECT_COLUMNS)
    .eq("is_active", true)
    .order("product_name", { ascending: true })
    .limit(EXPORT_LIMIT);

  const { data, error } = await applyFilters(baseQuery, filters);
  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as InventoryItemJoinedRow[]).map(mapRow);
}

/**
 * Distinct, sorted list of custom "Other Spare Part" labels in use (e.g.
 * "Seat Cover", "Helmet Lock") — powers the extra options the Type filter
 * dropdown shows beneath the fixed enum types. Only active items count, so a
 * label stops appearing once its last item is deactivated.
 */
export async function listCustomTypeLabels(supabase: SupabaseClient<Database>): Promise<string[]> {
  const { data, error } = await supabase
    .from("inventory_items")
    .select("custom_type_label")
    .eq("is_active", true)
    .eq("item_type", "OTHER_SPARE_PART")
    .not("custom_type_label", "is", null);

  if (error) throw new Error(error.message);

  const labels = new Set<string>();
  for (const row of data ?? []) {
    const label = row.custom_type_label?.trim();
    if (label) labels.add(label);
  }
  return [...labels].sort((a, b) => a.localeCompare(b));
}

/**
 * Lightweight dashboard counters for the Inventory stat cards. Runs as
 * independent, indexed count queries (is_active/stock_status are both
 * indexed — see 0001_inventory_schema.sql) in parallel rather than one
 * heavier aggregate query.
 *
 * inventoryValueCost sums each batch's remaining_quantity × its own
 * unit_price (doc/purchase-batch-fifo-scope.md §4) — not
 * purchase_price × available_quantity. That flat calc used one blended/
 * latest cost for a whole item even when it was bought at different prices
 * across purchases; batches keep each portion of stock at what it actually
 * cost.
 */
export async function getInventoryStats(supabase: SupabaseClient<Database>): Promise<InventoryStats> {
  const [totalRes, lowRes, outRes, valueRes] = await Promise.all([
    supabase.from("inventory_items").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase
      .from("inventory_items")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)
      .eq("stock_status", "low_stock"),
    supabase
      .from("inventory_items")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)
      .eq("stock_status", "out_of_stock"),
    // "!inner" forces an inner join so is_active can be filtered on the
    // embedded inventory_items resource (PostgREST requirement — see the
    // same pattern in services/purchases/entries.ts).
    supabase
      .from("purchase_entries")
      .select("remaining_quantity, unit_price, inventory_items!inner(is_active)")
      .eq("inventory_items.is_active", true),
  ]);

  if (totalRes.error) throw new Error(totalRes.error.message);
  if (lowRes.error) throw new Error(lowRes.error.message);
  if (outRes.error) throw new Error(outRes.error.message);
  if (valueRes.error) throw new Error(valueRes.error.message);

  const inventoryValueCost = (valueRes.data ?? []).reduce(
    (sum, row: { remaining_quantity: number; unit_price: number }) =>
      sum + row.remaining_quantity * Number(row.unit_price),
    0
  );

  return {
    totalProducts: totalRes.count ?? 0,
    lowStock: lowRes.count ?? 0,
    outOfStock: outRes.count ?? 0,
    inventoryValueCost,
  };
}

const IMAGE_BUCKET = "inventory-images";
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export class InvalidImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidImageError";
  }
}

/**
 * Uploads a product photo to the public `inventory-images` bucket (RLS there
 * is admin-write-only, mirroring inventory_items itself — see
 * 0002_inventory_images.sql) and returns its public URL for storage on the
 * item row.
 */
export async function uploadInventoryItemImage(
  supabase: SupabaseClient<Database>,
  file: File
): Promise<string> {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new InvalidImageError("Only PNG, JPEG, or WEBP images are allowed.");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new InvalidImageError("Image must be 5MB or smaller.");
  }

  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${crypto.randomUUID()}.${extension}`;

  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Track Tyre Front and Back are each their own singleton — at most one
 * active item per exact product name ("Track Tyre - Front" /
 * "Track Tyre - Back") should ever exist (see
 * doc/track-tyre-front-back-split-scope.md, and 0005_seed_track_tyre_brand.sql
 * for the matching single-brand rule that still applies to both). New Item
 * calls this with the derived name for whichever position was picked so it
 * can restock the matching existing item instead of inserting a duplicate —
 * an active Front item never blocks creating Back, and vice versa. If more
 * than one active row exists already for that exact name (e.g. a duplicate
 * from before this rule), the most recently created one wins — the rest are
 * orphaned duplicates that need manual cleanup, not auto-merged.
 */
export async function getActiveTrackTyreItem(
  supabase: SupabaseClient<Database>,
  productName: string
): Promise<InventoryItemRow | null> {
  const { data, error } = await supabase
    .from("inventory_items")
    .select(SELECT_COLUMNS)
    .eq("item_type", "TRACK_TYRE")
    .eq("product_name", productName)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  return mapRow(data as unknown as InventoryItemJoinedRow);
}

export async function getInventoryItem(
  supabase: SupabaseClient<Database>,
  id: string
): Promise<InventoryItemRow> {
  const { data, error } = await supabase
    .from("inventory_items")
    .select(SELECT_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new InventoryItemNotFoundError(id);

  return mapRow(data as unknown as InventoryItemJoinedRow);
}

// Item creation moved to services/purchases/item-creation.ts
// (createInventoryItemWithPurchase, calling the create_inventory_item_with_
// purchase() DB function) — Purchases is now the sole place items get
// created (doc/inventory-purchase-simplification-scope.md). Only editing an
// *existing* item's master data lives here.

function rethrowIfDuplicate(error: { code?: string; message: string; details?: string | null }): never {
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
 * Edit Item Details (Purchases-side) — master data only. Deliberately never
 * touches purchase_price/selling_price (those are auto-synced *reference*
 * values, driven only by record_purchase_entry()) or available_quantity
 * (only adjustStock() can change that).
 */
export async function updateInventoryItemDetails(
  supabase: SupabaseClient<Database>,
  id: string,
  rawInput: ItemDetailsInput
): Promise<InventoryItemRow> {
  const input = itemDetailsInputSchema.parse(rawInput);
  const isOtherSparePart = input.itemType === "OTHER_SPARE_PART";

  // sku_code is conditionally excluded: a blank value means "leave the
  // existing code alone" — it must never be blanked out or silently
  // regenerated on an edit, since the item already has a real code in
  // circulation.
  const trimmedSku = input.skuCode?.trim();

  const payload = {
    item_type: input.itemType,
    product_name: input.productName,
    brand_id: input.brandId,
    low_stock_threshold: input.lowStockThreshold,
    image_url: input.imageUrl ?? null,
    custom_type_label: isOtherSparePart ? (input.customTypeLabel?.trim() ?? null) : null,
    ...(trimmedSku ? { sku_code: trimmedSku } : {}),
  };

  const { data, error } = await supabase
    .from("inventory_items")
    .update(payload)
    .eq("id", id)
    .select(SELECT_COLUMNS)
    .maybeSingle();

  if (error) rethrowIfDuplicate(error);
  if (!data) throw new InventoryItemNotFoundError(id);

  return mapRow(data as unknown as InventoryItemJoinedRow);
}

export async function deactivateInventoryItem(
  supabase: SupabaseClient<Database>,
  id: string
): Promise<void> {
  const { error, data } = await supabase
    .from("inventory_items")
    .update({ is_active: false })
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new InventoryItemNotFoundError(id);
}

/**
 * Hard-deletes an item. Only succeeds if nothing references it (no
 * purchase/sale/service/adjustment history) — `inventory_items` is
 * referenced by `stock_movements` with `on delete restrict`, so Postgres
 * itself refuses the delete (error 23503) when history exists. Callers
 * should catch `InventoryItemHasHistoryError` and offer Deactivate instead.
 */
export async function deleteInventoryItem(
  supabase: SupabaseClient<Database>,
  id: string
): Promise<void> {
  const { error, data } = await supabase
    .from("inventory_items")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "23503") {
      throw new InventoryItemHasHistoryError();
    }
    throw new Error(error.message);
  }
  if (!data) throw new InventoryItemNotFoundError(id);
}
