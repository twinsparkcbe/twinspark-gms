import type { ItemType } from "@/types/database.types";
import type { InventoryItemRow, StockAdjustmentInput } from "@/services/inventory";

export const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  TRACK_TYRE: "Track Tyre",
  BRAND_NEW_TYRE: "Brand New Tyre",
  ENGINE_OIL: "Engine Oil",
  CHAIN: "Chain",
  SPROCKET_KIT: "Sprocket Kit",
  BRAKE_PART: "Brake Part",
  LUBRICANT: "Lubricant",
  ACCESSORY: "Accessory",
  OTHER_SPARE_PART: "Other Spare Part",
};

export const ITEM_TYPE_OPTIONS = Object.entries(ITEM_TYPE_LABELS).map(([value, label]) => ({
  value: value as ItemType,
  label,
}));

// Track Tyres don't have a real, meaningful brand (generic/re-tread tyres,
// not a branded product) — the item form locks Brand to this one shared
// value whenever Item Type = Track Tyre (see 0005_seed_track_tyre_brand.sql
// and item-form-dialog.tsx). Matched case-insensitively against the brands
// list, since the seed migration and any manually-created fallback should
// both resolve to the same row.
export const TRACK_TYRE_BRAND_NAME = "Track Tyre";

// Front and back track tyres are physically different (different size/cost)
// so each is its own inventory item with its own price/stock — see
// doc/track-tyre-front-back-split-scope.md. Rather than a free-typed Product
// Name (or a new DB column), Track Tyre gets a fixed 2-choice Position
// selector and the name is always derived from it, so "Track Tyre - Front"
// and "Track Tyre - Back" are the only two valid names for this item type.
export type TrackTyrePosition = "Front" | "Back";

export const TRACK_TYRE_POSITION_OPTIONS: { value: TrackTyrePosition; label: string }[] = [
  { value: "Front", label: "Front" },
  { value: "Back", label: "Back" },
];

export function buildTrackTyreProductName(position: TrackTyrePosition): string {
  return `Track Tyre - ${position}`;
}

/**
 * Inverse of buildTrackTyreProductName — used to preselect the Position
 * field when editing an existing Track Tyre item. Returns null for anything
 * that doesn't match exactly, including the legacy singleton name
 * ("Track Tyre") from before this split, so Edit Item Details forces an
 * explicit one-time Front/Back pick to relabel it rather than guessing.
 */
export function getTrackTyrePosition(productName: string): TrackTyrePosition | null {
  const normalized = productName.trim().toLowerCase();
  const match = TRACK_TYRE_POSITION_OPTIONS.find(
    (option) => buildTrackTyreProductName(option.value).toLowerCase() === normalized
  );
  return match?.value ?? null;
}

/**
 * Text for the Type badge — Other Spare Part shows the item's own
 * customTypeLabel (e.g. "Helmet Lock") instead of the generic label, since
 * that's the whole point of the field. Falls back to the static label if
 * customTypeLabel is somehow missing (defensive; the DB constraint in
 * 0003_inventory_custom_type_sku.sql should prevent this from happening).
 */
export function getItemTypeBadgeText(item: Pick<InventoryItemRow, "itemType" | "customTypeLabel">): string {
  if (item.itemType === "OTHER_SPARE_PART" && item.customTypeLabel?.trim()) {
    return item.customTypeLabel.trim();
  }
  return ITEM_TYPE_LABELS[item.itemType];
}

// Cool-toned palette, deliberately avoiding red/orange/green — those hues are
// reserved for the success/warning/danger stock-status pills, so a type
// badge and a status pill in the same row never read as the same signal.
export const ITEM_TYPE_BADGE_CLASS: Record<ItemType, string> = {
  TRACK_TYRE: "bg-indigo-50 text-indigo-600",
  BRAND_NEW_TYRE: "bg-sky-50 text-sky-600",
  ENGINE_OIL: "bg-teal-50 text-teal-600",
  CHAIN: "bg-cyan-50 text-cyan-600",
  SPROCKET_KIT: "bg-violet-50 text-violet-600",
  BRAKE_PART: "bg-fuchsia-50 text-fuchsia-600",
  LUBRICANT: "bg-blue-50 text-blue-600",
  ACCESSORY: "bg-purple-50 text-purple-600",
  OTHER_SPARE_PART: "bg-slate-100 text-slate-600",
};

export const STOCK_STATUS_LABELS = {
  in_stock: "In Stock",
  low_stock: "Low Stock",
  out_of_stock: "Out of Stock",
} as const;

export const STOCK_STATUS_OPTIONS = Object.entries(STOCK_STATUS_LABELS).map(([value, label]) => ({
  value: value as keyof typeof STOCK_STATUS_LABELS,
  label,
}));

/**
 * Row tint for the item list. Status is carried by the row background rather
 * than a badge in its own column, because a tint is the only status signal
 * that survives peripheral vision — scanning one column for a badge was the
 * old screen's core problem (doc/inventory-redesign-scope.md §3e).
 *
 * `null` for healthy stock: most rows stay plain white, so the tinted ones
 * actually stand out.
 */
export function stockRowTone(
  item: Pick<InventoryItemRow, "stockStatus">
): "danger" | "warning" | null {
  if (item.stockStatus === "out_of_stock") return "danger";
  if (item.stockStatus === "low_stock") return "warning";
  return null;
}

/**
 * "0 / 5" — available quantity against its reorder threshold. Deliberately
 * spelled out rather than left to colour alone, so the state is legible
 * without colour perception. Never clamped: stock well above the threshold
 * reads "114 / 20", which is useful information in itself.
 */
export function formatStockRatio(
  item: Pick<InventoryItemRow, "availableQuantity" | "lowStockThreshold">
): string {
  return `${item.availableQuantity.toLocaleString("en-IN")} / ${item.lowStockThreshold.toLocaleString("en-IN")}`;
}

// doc/inventory-purchase-simplification-scope.md §2.2 — item creation
// (including any "opening" quantity) always comes through Purchases now, so
// nothing here needs a separate "Opening Stock" label anymore.
export const STOCK_ADJUSTMENT_REASON_OPTIONS: StockAdjustmentInput["reasonLabel"][] = [
  "Damaged",
  "Manufacturing Defect",
  "Lost/Missing",
  "Customer Return",
  "Supplier Return",
  "Manual Correction",
  "Other",
];
