import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  InsufficientStockError,
  StockAdjustmentAuthError,
  StockAdjustmentValidationError,
} from "@/services/shared/stock";
import type { Database, ItemType } from "@/types/database.types";

import {
  purchaseEntryEditInputSchema,
  purchaseEntryInputSchema,
  type PurchaseEntryEditInput,
  type PurchaseEntryFilters,
  type PurchaseEntryInput,
} from "./schemas";

export class PurchaseEntryNotFoundError extends Error {
  constructor(id: string) {
    super(`Purchase entry ${id} not found.`);
    this.name = "PurchaseEntryNotFoundError";
  }
}

/** Raised when record_purchase_entry() can't find the item, or it's deactivated (P0002). */
export class PurchaseItemUnavailableError extends Error {
  constructor() {
    super("This item doesn't exist or is no longer active.");
    this.name = "PurchaseItemUnavailableError";
  }
}

export interface PurchaseEntryRow {
  id: string;
  inventoryItemId: string;
  itemName: string;
  itemSkuCode: string;
  itemType: ItemType;
  /** Only set (and only meaningful) when itemType is OTHER_SPARE_PART — mirrors InventoryItemRow. */
  customTypeLabel: string | null;
  brandName: string | null;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  /** Auto-generated, e.g. "BATCH-000001" (0010_purchase_batch_fifo.sql). */
  batchNumber: string;
  /** How much of this batch hasn't been sold/returned yet. */
  remainingQuantity: number;
  /** Required per-batch selling price (0011_purchases_item_ownership.sql). */
  sellingPrice: number;
  supplierName: string | null;
  purchaseDate: string;
  note: string | null;
  createdAt: string;
}

export interface PurchaseStats {
  /** Sum of total_amount for entries within the queried date range. */
  totalPurchaseAmount: number;
  entryCount: number;
}

type JoinedItem = {
  product_name: string;
  sku_code: string;
  item_type: ItemType;
  custom_type_label: string | null;
  brands: { name: string } | { name: string }[] | null;
};

type PurchaseEntryJoinedRow = {
  id: string;
  inventory_item_id: string;
  quantity: number;
  unit_price: number;
  total_amount: number;
  batch_number: string;
  remaining_quantity: number;
  selling_price: number;
  supplier_name: string | null;
  purchase_date: string;
  note: string | null;
  created_at: string;
  inventory_items: JoinedItem | JoinedItem[] | null;
};

function firstOrSelf<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function mapRow(row: PurchaseEntryJoinedRow): PurchaseEntryRow {
  const item = firstOrSelf(row.inventory_items);
  return {
    id: row.id,
    inventoryItemId: row.inventory_item_id,
    itemName: item?.product_name ?? "Deleted item",
    itemSkuCode: item?.sku_code ?? "—",
    itemType: item?.item_type ?? "OTHER_SPARE_PART",
    customTypeLabel: item?.custom_type_label ?? null,
    brandName: item ? (firstOrSelf(item.brands)?.name ?? null) : null,
    quantity: row.quantity,
    unitPrice: Number(row.unit_price),
    totalAmount: Number(row.total_amount),
    batchNumber: row.batch_number,
    remainingQuantity: row.remaining_quantity,
    sellingPrice: Number(row.selling_price),
    supplierName: row.supplier_name,
    purchaseDate: row.purchase_date,
    note: row.note,
    createdAt: row.created_at,
  };
}

// "!inner" forces an inner join so item type/brand can be filtered/sorted on
// via the embedded resource (PostgREST requirement — a left join can't be
// filtered this way). Every purchase_entries row always has a matching
// inventory_items row (on delete restrict — see 0009_purchase_schema.sql),
// so the inner join never silently drops a row.
const SELECT_COLUMNS =
  "id, inventory_item_id, quantity, unit_price, total_amount, batch_number, remaining_quantity, selling_price, supplier_name, purchase_date, note, created_at, inventory_items!inner(product_name, sku_code, item_type, custom_type_label, brand_id, brands(name))";

function applyFilters<T>(
  query: T,
  filters: Pick<PurchaseEntryFilters, "search" | "itemTypes" | "brandIds" | "dateFrom" | "dateTo">
): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = query as any;

  if (filters.search) {
    const term = filters.search.replace(/[,()]/g, " ").trim();
    if (term) {
      q = q.or(`product_name.ilike.%${term}%,sku_code.ilike.%${term}%`, { foreignTable: "inventory_items" });
    }
  }
  if (filters.itemTypes?.length) q = q.in("inventory_items.item_type", filters.itemTypes);
  if (filters.brandIds?.length) q = q.in("inventory_items.brand_id", filters.brandIds);
  if (filters.dateFrom) q = q.gte("purchase_date", filters.dateFrom.toISOString());
  if (filters.dateTo) q = q.lte("purchase_date", filters.dateTo.toISOString());

  return q as T;
}

/**
 * "amount" sorts biggest spend first (High to Low) — more useful for
 * reviewing purchase history than ascending, unlike Inventory's "price"
 * sort which is Low to High for browsing a catalog.
 */
function applySort<T>(query: T, sortBy: PurchaseEntryFilters["sortBy"] | undefined): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = query as any;
  switch (sortBy ?? "newest") {
    case "amount":
      return q.order("total_amount", { ascending: false }) as T;
    case "name":
      return q.order("product_name", { ascending: true, foreignTable: "inventory_items" }) as T;
    case "newest":
    default:
      return q.order("created_at", { ascending: false }) as T;
  }
}

export async function listPurchaseEntries(
  supabase: SupabaseClient<Database>,
  filters: PurchaseEntryFilters
): Promise<{ entries: PurchaseEntryRow[]; total: number }> {
  const from = (filters.page - 1) * filters.pageSize;
  const to = from + filters.pageSize - 1;

  const baseQuery = applySort(
    supabase.from("purchase_entries").select(SELECT_COLUMNS, { count: "exact" }),
    filters.sortBy
  ).range(from, to);

  const { data, error, count } = await applyFilters(baseQuery, filters);
  if (error) throw new Error(error.message);

  return {
    entries: ((data ?? []) as unknown as PurchaseEntryJoinedRow[]).map(mapRow),
    total: count ?? 0,
  };
}

export async function getPurchaseEntry(
  supabase: SupabaseClient<Database>,
  id: string
): Promise<PurchaseEntryRow> {
  const { data, error } = await supabase
    .from("purchase_entries")
    .select(SELECT_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new PurchaseEntryNotFoundError(id);

  return mapRow(data as unknown as PurchaseEntryJoinedRow);
}

/**
 * The only way to record a Purchase — calls record_purchase_entry()
 * (0009_purchase_schema.sql), which atomically increases stock via the
 * shared adjust_stock() path, syncs the item's reference purchase_price,
 * and inserts the purchase_entries row. Returns the full joined row so the
 * UI can render it immediately without a follow-up list refetch.
 */
export async function recordPurchaseEntry(
  supabase: SupabaseClient<Database>,
  rawInput: PurchaseEntryInput
): Promise<PurchaseEntryRow> {
  const input = purchaseEntryInputSchema.parse(rawInput);

  const { data, error } = await supabase.rpc("record_purchase_entry", {
    p_inventory_item_id: input.inventoryItemId,
    p_quantity: input.quantity,
    p_unit_price: input.unitPrice,
    p_purchase_date: input.purchaseDate.toISOString(),
    p_supplier_name: input.supplierName ?? null,
    p_note: input.note ?? null,
    p_selling_price: input.sellingPrice,
  });

  if (error) {
    if (error.code === "P0001") {
      throw new InsufficientStockError("Not enough stock available for this adjustment.");
    }
    if (error.code === "42501") {
      throw new StockAdjustmentAuthError("You don't have permission to record purchases.");
    }
    if (error.code === "P0002") {
      throw new PurchaseItemUnavailableError();
    }
    if (error.code === "22023") {
      throw new StockAdjustmentValidationError(error.message);
    }
    throw new Error(error.message);
  }
  if (typeof data !== "string") {
    throw new Error("Unexpected response from record_purchase_entry.");
  }

  return getPurchaseEntry(supabase, data);
}

/**
 * Corrects a data-entry mistake on an already-recorded batch — quantity,
 * purchase price, selling price, purchase date, supplier, note. Any batch
 * can be edited at any time (confirmed decision); reducing quantity below
 * what's already been sold/returned from this batch is still rejected, by
 * update_purchase_entry() reusing adjust_stock()'s remaining_quantity floor
 * check (0012_edit_purchase_entry.sql).
 */
export async function updatePurchaseEntry(
  supabase: SupabaseClient<Database>,
  entryId: string,
  rawInput: PurchaseEntryEditInput
): Promise<PurchaseEntryRow> {
  const input = purchaseEntryEditInputSchema.parse(rawInput);

  const { data, error } = await supabase.rpc("update_purchase_entry", {
    p_entry_id: entryId,
    p_quantity: input.quantity,
    p_unit_price: input.unitPrice,
    p_selling_price: input.sellingPrice,
    p_purchase_date: input.purchaseDate.toISOString(),
    p_supplier_name: input.supplierName ?? null,
    p_note: input.note ?? null,
  });

  if (error) {
    if (error.code === "P0001") {
      throw new InsufficientStockError(
        "Can't reduce quantity below what's already been sold or returned from this batch."
      );
    }
    if (error.code === "42501") {
      throw new StockAdjustmentAuthError("You don't have permission to edit purchase entries.");
    }
    if (error.code === "P0002") {
      throw new PurchaseEntryNotFoundError(entryId);
    }
    if (error.code === "22023") {
      throw new StockAdjustmentValidationError(error.message);
    }
    throw new Error(error.message);
  }
  if (typeof data !== "string") {
    throw new Error("Unexpected response from update_purchase_entry.");
  }

  return getPurchaseEntry(supabase, data);
}

/**
 * Supplier name from the most recent purchase entry for this item — powers
 * Record Purchase's "Existing Item" prefill (unit/selling price prefill
 * client-side from InventoryItemRow's already-synced reference values;
 * supplier isn't tracked there, so it needs this separate lookup). Returns
 * null if the item has no purchase history yet or no supplier was recorded
 * on its latest batch.
 */
export async function getLatestPurchaseSupplier(
  supabase: SupabaseClient<Database>,
  inventoryItemId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("purchase_entries")
    .select("supplier_name")
    .eq("inventory_item_id", inventoryItemId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.supplier_name ?? null;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/**
 * Aggregate Purchase Amount for a date range — feeds the future Dashboard's
 * Profit = Sales − Purchase calc and the Purchase Report (scope doc §6), and
 * the Purchases list's stat cards. Defaults to the current month when no
 * range is given; search/itemTypes/brandIds (all optional) narrow the
 * aggregate to match whatever the list's own filters currently have
 * applied, via the same applyFilters() the list uses, so the cards and the
 * table never disagree about what's being summarized.
 */
export async function getPurchaseStats(
  supabase: SupabaseClient<Database>,
  range?: { from?: Date; to?: Date; search?: string; itemTypes?: ItemType[]; brandIds?: string[] }
): Promise<PurchaseStats> {
  const from = range?.from ?? startOfMonth(new Date());
  const to = range?.to ?? new Date();

  const baseQuery = supabase
    .from("purchase_entries")
    .select("total_amount, inventory_items!inner(product_name, sku_code, item_type, brand_id)");

  const { data, error } = await applyFilters(baseQuery, {
    search: range?.search,
    itemTypes: range?.itemTypes,
    brandIds: range?.brandIds,
    dateFrom: from,
    dateTo: to,
  });

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as { total_amount: number }[];
  return {
    totalPurchaseAmount: rows.reduce((sum, row) => sum + Number(row.total_amount), 0),
    entryCount: rows.length,
  };
}
