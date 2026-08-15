import { z } from "zod";

// Imported directly from the leaf schema module (not the "@/services/inventory"
// barrel) so this pure-Zod file doesn't pull in Inventory's server-only,
// Supabase-touching service files just for one shared constant.
import { ITEM_TYPES } from "@/services/inventory/schemas";

export const PURCHASE_SORT_OPTIONS = ["newest", "name", "amount"] as const;
export type PurchaseEntrySort = (typeof PURCHASE_SORT_OPTIONS)[number];

/**
 * Record Purchase form (Existing Item mode). purchaseDate defaults to "now"
 * in the UI but stays editable (backdating a delivery that was recorded
 * late) — must not be in the future (PUR-004). supplierName/note are
 * optional free text (scope doc §5 — no Supplier master table).
 *
 * sellingPrice is required (0011_purchases_item_ownership.sql /
 * doc/inventory-purchase-simplification-scope.md) — every batch always has
 * its own selling price now, no more nullable fallback.
 */
export const purchaseEntryInputSchema = z.object({
  inventoryItemId: z.string().uuid("Select an item"),
  quantity: z.coerce
    .number()
    .int("Quantity must be a whole number")
    .positive("Quantity must be greater than 0"),
  unitPrice: z.coerce.number().positive("Purchase price must be greater than 0"),
  sellingPrice: z.coerce.number().positive("Selling price must be greater than 0"),
  purchaseDate: z.coerce
    .date()
    .refine((d) => d.getTime() <= Date.now(), "Purchase date cannot be in the future"),
  supplierName: z.string().trim().max(200).optional(),
  note: z.string().trim().max(500).optional(),
});

export type PurchaseEntryInput = z.infer<typeof purchaseEntryInputSchema>;

/**
 * Edit Purchase Entry — corrects a data-entry mistake on an already-recorded
 * batch (quantity, purchase price, selling price, purchase date, supplier,
 * note). No inventoryItemId (a batch's item never changes) and no
 * restriction on how much of the batch has already been sold/returned —
 * confirmed decision: any batch can be edited at any time. Reducing quantity
 * below what's already been consumed from this batch is still rejected, but
 * server-side (0012_edit_purchase_entry.sql's update_purchase_entry(),
 * reusing adjust_stock()'s existing remaining_quantity floor check) rather
 * than here, since "how much has been consumed" is live database state.
 */
export const purchaseEntryEditInputSchema = z.object({
  quantity: z.coerce
    .number()
    .int("Quantity must be a whole number")
    .positive("Quantity must be greater than 0"),
  unitPrice: z.coerce.number().positive("Purchase price must be greater than 0"),
  sellingPrice: z.coerce.number().positive("Selling price must be greater than 0"),
  purchaseDate: z.coerce
    .date()
    .refine((d) => d.getTime() <= Date.now(), "Purchase date cannot be in the future"),
  supplierName: z.string().trim().max(200).optional(),
  note: z.string().trim().max(500).optional(),
});

export type PurchaseEntryEditInput = z.infer<typeof purchaseEntryEditInputSchema>;

/**
 * Record Purchase form (New Item mode) — creates the item's master data and
 * its opening batch in one submit (doc/inventory-purchase-simplification-
 * scope.md §1.1). Item-master fields mirror inventoryItemInputSchema minus
 * the price fields (which now live on the batch below, not the item), plus
 * the same batch fields as purchaseEntryInputSchema minus inventoryItemId
 * (there's no existing item to pick — this creates one).
 */
export const newItemWithPurchaseInputSchema = z
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
    quantity: z.coerce
      .number()
      .int("Quantity must be a whole number")
      .positive("Quantity must be greater than 0"),
    unitPrice: z.coerce.number().positive("Purchase price must be greater than 0"),
    sellingPrice: z.coerce.number().positive("Selling price must be greater than 0"),
    purchaseDate: z.coerce
      .date()
      .refine((d) => d.getTime() <= Date.now(), "Purchase date cannot be in the future"),
    supplierName: z.string().trim().max(200).optional(),
    note: z.string().trim().max(500).optional(),
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

export type NewItemWithPurchaseInput = z.infer<typeof newItemWithPurchaseInputSchema>;

/**
 * Purchase Return form. reason is required (mirrors the DB's
 * record_purchase_return() rule) — quantity-vs-remaining is validated
 * server-side against the live database state (rules.ts's helper is only a
 * client-side preview), since "remaining" can change between page load and
 * submit.
 */
export const purchaseReturnInputSchema = z.object({
  purchaseEntryId: z.string().uuid(),
  quantity: z.coerce
    .number()
    .int("Quantity must be a whole number")
    .positive("Quantity must be greater than 0"),
  reason: z.string().trim().min(1, "A reason is required"),
});

export type PurchaseReturnInput = z.infer<typeof purchaseReturnInputSchema>;

export const purchaseEntryFiltersSchema = z.object({
  // Matches the purchased item's product name / SKU (joined at query time).
  search: z.string().trim().optional(),
  itemTypes: z.array(z.enum(ITEM_TYPES)).optional(),
  brandIds: z.array(z.string().uuid()).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  sortBy: z.enum(PURCHASE_SORT_OPTIONS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PurchaseEntryFilters = z.infer<typeof purchaseEntryFiltersSchema>;
