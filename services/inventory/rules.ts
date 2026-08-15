import type { InventoryStats, StockStatus } from "./items";

/**
 * Pure business-rule helpers with no Supabase dependency — kept separate so
 * they're trivially unit-testable without mocking a DB client. The DB's
 * generated `stock_status` column (0001_inventory_schema.sql) is the actual
 * source of truth for stored/queried data; this mirrors that same logic for
 * optimistic client-side UI updates (e.g. right after adjustStock() returns
 * a new balance, before a refetch).
 */
export function deriveStockStatus(availableQuantity: number, lowStockThreshold: number): StockStatus {
  if (availableQuantity <= 0) return "out_of_stock";
  if (availableQuantity <= lowStockThreshold) return "low_stock";
  return "in_stock";
}

/**
 * Selling price below purchase price is allowed (not blocked) but should be
 * flagged as a warning in the UI — INV-009.
 */
export function isSellingPriceBelowPurchase(purchasePrice: number, sellingPrice: number): boolean {
  return sellingPrice < purchasePrice;
}

export interface StatusCounts {
  all: number;
  inStock: number;
  lowStock: number;
  outOfStock: number;
  /** Low + out — the "12 need attention" figure in the header summary. */
  needsAttention: number;
}

/**
 * Counts for the Inventory status chips, derived from the stats we already
 * fetch — no extra query (doc/inventory-redesign-scope.md §3b).
 *
 * `inStock` is clamped at zero because the three underlying counts come from
 * three separate `head: true` queries. A sale landing between them can make
 * low+out momentarily exceed the total, and a chip reading "-1" is worse than
 * one reading "0" for a state that resolves itself on the next refresh.
 */
export function deriveStatusCounts(stats: InventoryStats): StatusCounts {
  return {
    all: stats.totalProducts,
    inStock: Math.max(0, stats.totalProducts - stats.lowStock - stats.outOfStock),
    lowStock: stats.lowStock,
    outOfStock: stats.outOfStock,
    needsAttention: stats.lowStock + stats.outOfStock,
  };
}
