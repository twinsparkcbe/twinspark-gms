import { z } from "zod";

import { mobileNumberSchema } from "@/services/shared/mobile";
import { PAYMENT_MODES } from "@/services/shared/payment";

export const SALES_SORT_OPTIONS = ["newest", "amount"] as const;
export type SalesSort = (typeof SALES_SORT_OPTIONS)[number];

/**
 * One line on a Sale — either a PRODUCT (an inventory item + quantity) or an
 * INSTALLATION charge (its own line, not nested under a product — confirmed
 * design, doc/sales-module-scope.md §4). superRefine (not discriminatedUnion)
 * because INSTALLATION itself has two shapes (Tyre Fitting vs Custom) keyed
 * off installationSubtype — the same "conditional fields on one flat object"
 * pattern already used for OTHER_SPARE_PART's customTypeLabel in
 * services/purchases/schemas.ts's newItemWithPurchaseInputSchema.
 */
export const saleLineInputSchema = z
  .object({
    lineType: z.enum(["PRODUCT", "INSTALLATION", "COMBO"]),
    // PRODUCT fields.
    inventoryItemId: z.string().uuid().optional(),
    quantity: z.coerce
      .number()
      .int("Quantity must be a whole number")
      .positive("Quantity must be greater than 0")
      .optional(),
    /**
     * Negotiated price for THIS sale only (0034). Omitted means "charge the
     * catalogue price", which is what every caller did before this existed —
     * so leaving it out preserves the original behaviour exactly. The server
     * re-validates and applies the below-cost rule; this is the first gate,
     * not the only one.
     */
    unitSellingPrice: z.coerce
      .number()
      .positive("Price must be greater than 0")
      .optional(),
    // INSTALLATION fields.
    installationSubtype: z.enum(["TYRE_FITTING", "CUSTOM"]).optional(),
    /** COMBO only — the server expands the bundle from this id. */
    comboId: z.string().uuid().optional(),
    /** Tyre Fitting only — drives the auto-calculated wheel_count x ₹300. */
    wheelCount: z.coerce
      .number()
      .int("Wheel count must be a whole number")
      .positive("Wheel count must be greater than 0")
      .optional(),
    /** Custom only — required description of what's being installed. */
    description: z.string().trim().max(200).optional(),
    /**
     * Custom: required, typed in manually every time (no stored default —
     * confirmed). Tyre Fitting: optional override of the auto-calculated
     * amount for a one-off rate; omitted means "use the formula."
     */
    amount: z.coerce.number().min(0, "Amount must be zero or greater").optional(),
    installedBy: z.string().trim().max(100).optional(),
  })
  .superRefine((line, ctx) => {
    if (line.lineType === "PRODUCT") {
      if (!line.inventoryItemId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["inventoryItemId"], message: "Select an item" });
      }
      if (line.quantity === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["quantity"], message: "Quantity is required" });
      }
      return;
    }

    // INSTALLATION
    if (!line.installationSubtype) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["installationSubtype"],
        message: "Select a fitting type",
      });
      return;
    }
    if (line.installationSubtype === "TYRE_FITTING") {
      if (line.wheelCount === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["wheelCount"], message: "Wheel count is required" });
      }
    } else {
      if (!line.description || !line.description.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["description"], message: "Description is required" });
      }
      if (line.amount === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["amount"], message: "Amount is required" });
      }
    }
  });

export type SaleLineInput = z.infer<typeof saleLineInputSchema>;

/**
 * New Sale form. customerMobile is the find-or-create key (scope doc §2) —
 * an existing match reuses that customer, a new number creates one. At
 * least one PRODUCT line is required (SALE-011); the "does this sale have a
 * product line" check happens here AND again server-side in record_sale()
 * since the authoritative line list is only known once lines are parsed.
 */
/**
 * Payment capture shared by Sales and Service. Amounts are validated against
 * the bill total server-side (the authoritative grand total only exists once
 * lines are priced), so the checks here are the cheap, obviously-wrong ones:
 * shape, sign, and a known mode.
 */
export const paymentInputSchema = z.object({
  mode: z.enum(PAYMENT_MODES).nullable(),
  cashAmount: z.coerce.number().min(0, "Amount can't be negative").default(0),
  upiAmount: z.coerce.number().min(0, "Amount can't be negative").default(0),
});

export const saleInputSchema = z
  .object({
    customerName: z.string().trim().min(1, "Customer name is required"),
    customerMobile: mobileNumberSchema,
    customerAddress: z.string().trim().max(300).optional(),
    gstApplicable: z.boolean().default(false),
    gstAmount: z.coerce.number().min(0, "GST amount must be zero or greater").default(0),
    discountApplicable: z.boolean().default(false),
    discountAmount: z.coerce.number().min(0, "Discount amount must be zero or greater").default(0),
    lines: z.array(saleLineInputSchema).min(1, "Add at least one line item"),
    /**
     * How the money came in (0027). Required, with no default on purpose:
     * an omitted payment block used to silently mean "PAID", so a caller
     * that forgot the field recorded a settled bill. Now it has to say.
     * `paymentStatus` is no longer accepted here at all — it is derived
     * server-side from these amounts (services/shared/payment.ts).
     */
    payment: paymentInputSchema,
    /** Who made the sale (0029). Optional — "Unassigned" is a valid state, and
     * the empty string a <Select/> emits for it normalizes to undefined rather
     * than failing uuid validation. Same treatment as Service's
     * assignedMechanicId. */
    soldById: z.preprocess(
      (value) => (value === "" || value === null ? undefined : value),
      z.string().uuid("Select a valid staff member").optional()
    ),
  })
  .superRefine((value, ctx) => {
    // A combo expands server-side into product rows, so it satisfies the
    // "a sale must move something" rule just as a bare product does.
    const hasProduct = value.lines.some((line) => line.lineType === "PRODUCT" || line.lineType === "COMBO");
    if (!hasProduct) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lines"],
        message: "A sale requires at least one product",
      });
    }
  });

export type SaleInput = z.infer<typeof saleInputSchema>;

/**
 * Correcting a recorded sale (doc/sales-edit-void-scope.md §3). Same payload as
 * recording one — the edit screen is the same form — plus the sale's id. The
 * tender travels with it because a correction that moves the total moves what's
 * owed, and making the user fix that in a second dialog is how a bill ends up
 * sitting at PARTIAL forever.
 */
export const saleEditInputSchema = z.object({
  saleId: z.string().uuid(),
  input: saleInputSchema,
});

export type SaleEditInput = z.infer<typeof saleEditInputSchema>;

/**
 * Voiding a sale (§4). A reason is mandatory, same as Undo Sale Return (0015)
 * and Undo Service Completion (0028): a void removes both stock and cash from
 * every report, and months later this line is the only record of why.
 */
export const voidSaleInputSchema = z.object({
  saleId: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(3, "Give a short reason (at least 3 characters)")
    .max(500, "Keep the reason under 500 characters"),
});

export type VoidSaleInput = z.infer<typeof voidSaleInputSchema>;

/** Record Payment dialog — settling a bill after the fact (0027). */
export const salePaymentInputSchema = z.object({
  saleId: z.string().uuid(),
  payment: paymentInputSchema,
});

export type SalePaymentUpdateInput = z.infer<typeof salePaymentInputSchema>;

/**
 * Sale Return form. reason is required (mirrors record_sale_return()'s DB
 * rule) — quantity-vs-remaining is validated server-side against live
 * database state, same reasoning as Purchase Return.
 */
export const saleReturnInputSchema = z.object({
  saleItemId: z.string().uuid(),
  quantity: z.coerce
    .number()
    .int("Quantity must be a whole number")
    .positive("Quantity must be greater than 0"),
  reason: z.string().trim().min(1, "A reason is required"),
});

export type SaleReturnInput = z.infer<typeof saleReturnInputSchema>;

/** Undo Sale Return (scope doc §6a) — targets one specific sale_returns
 * record; a reason is required, same convention as every other
 * stock-correcting action in this system. */
export const undoSaleReturnInputSchema = z.object({
  saleReturnId: z.string().uuid(),
  reason: z.string().trim().min(1, "A reason is required"),
});

export type UndoSaleReturnInput = z.infer<typeof undoSaleReturnInputSchema>;

/** Escalate to Service — flag + optional note only (scope doc §5). */
export const escalateSaleInputSchema = z.object({
  saleId: z.string().uuid(),
  note: z.string().trim().max(500).optional(),
});

export type EscalateSaleInput = z.infer<typeof escalateSaleInputSchema>;

/** Sentinel for "sold by nobody in particular" — a real profile id can't
 * collide with it, and it has to survive being a plain string through the
 * filter bar's <Select>, which can't carry a null value. */
export const UNASSIGNED_SOLD_BY = "UNASSIGNED";

export const saleFiltersSchema = z.object({
  // Matches customer name, mobile number, or invoice number (joined at query time).
  search: z.string().trim().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  sortBy: z.enum(SALES_SORT_OPTIONS).optional(),
  // A profile id, or UNASSIGNED_SOLD_BY for sales with no sold_by_id — not a
  // uuid() check for exactly that reason (doc/sales-edit-void-scope.md §2).
  soldById: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type SaleFilters = z.infer<typeof saleFiltersSchema>;
