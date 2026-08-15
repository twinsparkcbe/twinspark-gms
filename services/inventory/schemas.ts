import { z } from "zod";

export const ITEM_TYPES = [
  "TRACK_TYRE",
  "BRAND_NEW_TYRE",
  "ENGINE_OIL",
  "CHAIN",
  "SPROCKET_KIT",
  "BRAKE_PART",
  "LUBRICANT",
  "ACCESSORY",
  "OTHER_SPARE_PART",
] as const;

/**
 * Expanded from 3 generic labels to 7 specific ones
 * (doc/inventory-purchase-simplification-scope.md §2.2) — no DB enum change
 * needed, all 7 still collapse into the existing DAMAGE / MANUAL_CORRECTION
 * stock_movement_reason values (see toMovementReason() in
 * stock-adjustment.ts); the label itself carries the specific meaning in the
 * audit trail. "Opening Stock" is retired — item creation always comes with
 * an opening batch via Purchases now, so nothing needs a separate "opening"
 * label anymore.
 */
export const STOCK_ADJUSTMENT_REASONS = [
  "Damaged",
  "Manufacturing Defect",
  "Lost/Missing",
  "Customer Return",
  "Supplier Return",
  "Manual Correction",
  "Other",
] as const;

/**
 * Inventory item create/edit form. Category has been removed entirely
 * (client decision — it wasn't adding value in practice, see
 * 0004_remove_category_universal_brand.sql). Brand is now required on every
 * item type, sourced from the `brands` table (with an inline "create new
 * brand" fallback in the UI) rather than being exclusive to Brand New Tyre.
 */
export const inventoryItemInputSchema = z
  .object({
    itemType: z.enum(ITEM_TYPES),
    productName: z.string().trim().min(1, "Product name is required"),
    // Optional — left blank on create, the server auto-generates a
    // "SKU-00001"-style code (see createInventoryItem / next_inventory_sku()
    // in 0003_inventory_custom_type_sku.sql). On update, blank means "leave
    // the existing value alone" (see updateInventoryItem's toDbPayload use).
    skuCode: z.string().trim().optional(),
    brandId: z.string().uuid("Select or create a brand"),
    purchasePrice: z.coerce.number().positive("Purchase price must be greater than 0"),
    sellingPrice: z.coerce.number().positive("Selling price must be greater than 0"),
    lowStockThreshold: z.coerce
      .number()
      .int("Low stock threshold must be a whole number")
      .min(0, "Low stock threshold cannot be negative"),
    imageUrl: z.string().url().nullable().optional(),
    // Free-text description shown in place of the generic "Other Spare Part"
    // badge — required exactly when that type is picked, forbidden
    // otherwise (mirrors the DB check constraint in
    // 0003_inventory_custom_type_sku.sql). This is additive to the universal
    // brand requirement above, not a replacement for it.
    customTypeLabel: z.string().trim().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.itemType === "OTHER_SPARE_PART") {
      if (!value.customTypeLabel || !value.customTypeLabel.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["customTypeLabel"],
          message: "Specify what this item is",
        });
      }
    } else if (value.customTypeLabel) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customTypeLabel"],
        message: "Custom type label must be empty for this item type",
      });
    }
  });

export type InventoryItemInput = z.infer<typeof inventoryItemInputSchema>;

/**
 * Edit Item Details form (Purchases-side, doc/inventory-purchase-
 * simplification-scope.md §1.2) — master data only. Deliberately excludes
 * purchasePrice/sellingPrice: those are auto-synced *reference* values now,
 * driven only by the newest batch (record_purchase_entry()) — editing an
 * item's details must never be able to overwrite them.
 */
export const itemDetailsInputSchema = z
  .object({
    itemType: z.enum(ITEM_TYPES),
    productName: z.string().trim().min(1, "Product name is required"),
    skuCode: z.string().trim().optional(),
    brandId: z.string().uuid("Select or create a brand"),
    lowStockThreshold: z.coerce
      .number()
      .int("Low stock threshold must be a whole number")
      .min(0, "Low stock threshold cannot be negative"),
    imageUrl: z.string().url().nullable().optional(),
    customTypeLabel: z.string().trim().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.itemType === "OTHER_SPARE_PART") {
      if (!value.customTypeLabel || !value.customTypeLabel.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["customTypeLabel"],
          message: "Specify what this item is",
        });
      }
    } else if (value.customTypeLabel) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customTypeLabel"],
        message: "Custom type label must be empty for this item type",
      });
    }
  });

export type ItemDetailsInput = z.infer<typeof itemDetailsInputSchema>;

// "urgency" leads because it's the default (doc/inventory-redesign-scope.md
// §3d) — the owner opens Inventory to find problems, and "newest" correlated
// with nothing they care about.
export const INVENTORY_SORT_OPTIONS = ["urgency", "newest", "name", "stock"] as const;
export type InventoryItemSort = (typeof INVENTORY_SORT_OPTIONS)[number];

export const inventoryItemFiltersSchema = z.object({
  search: z.string().trim().optional(),
  // Multi-select, match-ANY: items matching any listed type/brand are shown.
  // Omitted or empty means "no filter".
  itemTypes: z.array(z.enum(ITEM_TYPES)).optional(),
  brandIds: z.array(z.string().uuid()).optional(),
  stockStatus: z.enum(["in_stock", "low_stock", "out_of_stock"]).optional(),
  sortBy: z.enum(INVENTORY_SORT_OPTIONS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type InventoryItemFilters = z.infer<typeof inventoryItemFiltersSchema>;

export const stockAdjustmentInputSchema = z
  .object({
    itemId: z.string().uuid(),
    delta: z.coerce.number().int().refine((n) => n !== 0, "Adjustment cannot be zero"),
    reasonLabel: z.enum(STOCK_ADJUSTMENT_REASONS),
    // Always optional now. The DB's adjust_stock() requires a note for
    // MANUAL_CORRECTION/DAMAGE, but toLoggedNote() (stock-adjustment.ts)
    // always prepends the reason label, so what reaches the DB is never
    // empty even when the user leaves this blank — the label itself
    // satisfies the constraint and still records why.
    note: z.string().trim().optional(),
    // Only meaningful (and only allowed) when reasonLabel is "Other" — the
    // user's own description of what it actually is, logged in place of the
    // generic word "Other" (see stock-adjustment.ts).
    customReason: z.string().trim().optional(),
    // Only meaningful for a positive delta (a new synthetic batch is
    // created behind the scenes — see doc/purchase-batch-fifo-scope.md §3).
    // Optional: falls back to the item's most recent batch cost in the DB
    // function when omitted (confirmed default — favors speed for a quick
    // stock-take fix over forcing an exact figure every time).
    unitCost: z.coerce.number().positive("Cost per unit must be greater than 0").optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.unitCost !== undefined && value.delta <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unitCost"],
        message: "Cost per unit only applies when adding stock",
      });
    }
    if (value.reasonLabel === "Other") {
      if (!value.customReason?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["customReason"],
          message: "Specify what this reason is",
        });
      }
    } else if (value.customReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customReason"],
        message: "Custom reason must be empty for this reason",
      });
    }
  });

export type StockAdjustmentInput = z.infer<typeof stockAdjustmentInputSchema>;

export const brandInputSchema = z.object({
  name: z.string().trim().min(1, "Brand name is required"),
  // Brands are scoped to one item type (see 0006_brand_per_item_type.sql) —
  // the item form supplies the currently-selected type when creating one.
  itemType: z.enum(ITEM_TYPES),
});
