import { z } from "zod";
import { PAYMENT_MODES } from "@/services/shared/payment";

import { mobileNumberSchema } from "@/services/shared/mobile";

export const SERVICE_JOB_STATUSES = ["DRAFT", "IN_PROGRESS", "READY_FOR_DELIVERY", "COMPLETED", "CANCELLED"] as const;
export const SERVICE_PAYMENT_STATUSES = ["PENDING", "PARTIAL", "PAID", "FREE_SERVICE"] as const;
export const SERVICE_DELIVERY_STATUSES = ["WAITING", "READY_FOR_PICKUP", "DELIVERED"] as const;

/**
 * One line on a Service Job — a General Service Package, a Specific
 * Service, or a free-typed Custom line (doc/service-module-scope.md §4/§8).
 * All three share the same description/quantity/rate shape (§9); the
 * difference is only where description/rate initially come from.
 * superRefine (not discriminatedUnion) for the same reason as Sales'
 * saleLineInputSchema — PACKAGE/SPECIFIC need a catalog id, CUSTOM needs a
 * typed description, on one flat object.
 */
export const serviceJobLineInputSchema = z
  .object({
    lineType: z.enum(["PACKAGE", "SPECIFIC", "CUSTOM", "COMBO"]),
    generalServicePackageId: z.string().uuid().optional(),
    specificServiceId: z.string().uuid().optional(),
    /** Combo Offers (0022) — a COMBO line is one fixed price covering
     * everything the combo contains. */
    comboId: z.string().uuid().optional(),
    /** Snapshotted content list printed under the combo line, unpriced. */
    comboContents: z.array(z.string().trim().max(200)).optional(),
    description: z.string().trim().max(200).optional(),
    quantity: z.coerce.number().int("Quantity must be a whole number").positive("Quantity must be greater than 0").default(1),
    rate: z.coerce.number().min(0, "Rate must be zero or greater"),
  })
  .superRefine((line, ctx) => {
    if (line.lineType === "PACKAGE" && !line.generalServicePackageId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["generalServicePackageId"], message: "Select a package" });
    }
    if (line.lineType === "SPECIFIC" && !line.specificServiceId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["specificServiceId"], message: "Select a service" });
    }
    if (line.lineType === "CUSTOM" && (!line.description || !line.description.trim())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["description"], message: "Description is required" });
    }
    if (line.lineType === "COMBO" && !line.comboId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["comboId"], message: "Select a combo" });
    }
  });

export type ServiceJobLineInput = z.infer<typeof serviceJobLineInputSchema>;

/** A part/consumable used on the job — quantity only; price is snapshotted
 * server-side from the item's current selling price (doc §16). No stock is
 * deducted at this point (doc §6) — that only happens at completion. */
export const serviceInventoryUsageInputSchema = z.object({
  inventoryItemId: z.string().uuid(),
  quantityUsed: z.coerce.number().int("Quantity must be a whole number").positive("Quantity must be greater than 0"),
  /** Combo Offers (0022) — which combo brought this part in, if any. */
  comboId: z.string().uuid().optional(),
  /** Bills at ₹0 because the combo price already covers it. The server
   * forces the price to zero when this is set, rather than trusting a
   * client-sent amount. */
  includedInCombo: z.boolean().optional(),
});

export type ServiceInventoryUsageInput = z.infer<typeof serviceInventoryUsageInputSchema>;

/**
 * Create/Update Service Job form. Unlike Sales, zero lines is valid here —
 * a Draft can be saved before staff has decided what's being done (doc §4).
 * customerMobile/vehicleNumber are both find-or-create keys (doc §2).
 */
export const serviceJobInputSchema = z.object({
  customerName: z.string().trim().min(1, "Customer name is required"),
  customerMobile: mobileNumberSchema,
  customerAddress: z.string().trim().max(300).optional(),
  vehicleNumber: z.string().trim().min(1, "Vehicle number is required"),
  vehicleModel: z.string().trim().min(1, "Vehicle model is required"),
  odometerReading: z.coerce.number().int("Odometer reading must be a whole number").min(0, "Odometer reading must be zero or greater"),
  complaintNotes: z.string().trim().max(1000).optional(),
  mechanicNotes: z.string().trim().max(1000).optional(),
  expectedDeliveryAt: z.coerce.date().optional(),
  gstApplicable: z.boolean().default(false),
  gstAmount: z.coerce.number().min(0, "GST amount must be zero or greater").default(0),
  discountApplicable: z.boolean().default(false),
  discountAmount: z.coerce.number().min(0, "Discount amount must be zero or greater").default(0),
  lines: z.array(serviceJobLineInputSchema).default([]),
  usage: z.array(serviceInventoryUsageInputSchema).default([]),
  /** Which Mechanic is working this job (0026_mechanic_access.sql).
   * Informational, never an access gate. "Unassigned" is a valid state, and
   * the empty string a <Select/> emits for it normalizes to undefined rather
   * than failing uuid validation. */
  assignedMechanicId: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.string().uuid("Select a valid mechanic").optional()
  ),
});

export type ServiceJobInput = z.infer<typeof serviceJobInputSchema>;

export const serviceJobStatusInputSchema = z.object({
  serviceJobId: z.string().uuid(),
  newStatus: z.enum(["DRAFT", "IN_PROGRESS", "READY_FOR_DELIVERY", "CANCELLED"]),
  note: z.string().trim().max(500).optional(),
});

export type ServiceJobStatusInput = z.infer<typeof serviceJobStatusInputSchema>;

/**
 * Payment on a Service Job (0027). `paymentStatus` is no longer accepted —
 * it's derived server-side from the amounts, except for FREE_SERVICE, which
 * stays an explicit flag because ₹0 on a warranty job and ₹0 on an unpaid
 * one are different business facts that no amount can distinguish.
 */
export const servicePaymentStatusInputSchema = z.object({
  serviceJobId: z.string().uuid(),
  payment: z.object({
    mode: z.enum(PAYMENT_MODES).nullable(),
    cashAmount: z.coerce.number().min(0, "Amount can't be negative").default(0),
    upiAmount: z.coerce.number().min(0, "Amount can't be negative").default(0),
    freeService: z.boolean().optional(),
  }),
});

export type ServicePaymentStatusInput = z.infer<typeof servicePaymentStatusInputSchema>;
export type ServicePaymentInput = ServicePaymentStatusInput["payment"];

/**
 * Reversing something already recorded (doc/service-edit-undo-scope.md §3).
 * A reason is mandatory — the same rule Undo Sale Return has carried since
 * 0015. It's the only thing that distinguishes "billed the wrong bike" from
 * "customer changed their mind" three months later in the job timeline.
 */
export const serviceReversalInputSchema = z.object({
  serviceJobId: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(3, "Give a short reason (at least 3 characters)")
    .max(500, "Keep the reason under 500 characters"),
});

export type ServiceReversalInput = z.infer<typeof serviceReversalInputSchema>;

/**
 * Correcting a job that's already been billed (doc §2). Same job payload as a
 * normal edit, plus the tender — because a correction that moves the total
 * usually moves what's owed, and making the admin fix that in a second dialog
 * is how a job ends up sitting at PARTIAL forever.
 */
export const completedServiceJobEditInputSchema = z.object({
  serviceJobId: z.string().uuid(),
  input: serviceJobInputSchema,
  payment: z.object({
    mode: z.enum(PAYMENT_MODES).nullable(),
    cashAmount: z.coerce.number().min(0, "Amount can't be negative").default(0),
    upiAmount: z.coerce.number().min(0, "Amount can't be negative").default(0),
    freeService: z.boolean().optional(),
  }),
});

export type CompletedServiceJobEditInput = z.infer<typeof completedServiceJobEditInputSchema>;

export const serviceDeliveryStatusInputSchema = z.object({
  serviceJobId: z.string().uuid(),
  deliveryStatus: z.enum(SERVICE_DELIVERY_STATUSES),
});

export type ServiceDeliveryStatusInput = z.infer<typeof serviceDeliveryStatusInputSchema>;

export const serviceJobFiltersSchema = z.object({
  // Matches Vehicle Number, Customer Name, Mobile Number, Job Number, or
  // Invoice Number (doc §20) — single unified search, resolved at query time.
  search: z.string().trim().optional(),
  status: z.enum(SERVICE_JOB_STATUSES).optional(),
  /** A mechanic's id, or the literal "UNASSIGNED" for jobs nobody is on. */
  assignedMechanicId: z.string().trim().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ServiceJobFilters = z.infer<typeof serviceJobFiltersSchema>;

/** A default inventory item linked to a catalog entry (doc §3, Revision 3)
 * — auto-populates Parts Used when that package/service is picked on a job. */
export const catalogDefaultItemInputSchema = z.object({
  inventoryItemId: z.string().uuid(),
  defaultQuantity: z.coerce.number().int("Quantity must be a whole number").positive("Quantity must be greater than 0").default(1),
});

export type CatalogDefaultItemInput = z.infer<typeof catalogDefaultItemInputSchema>;

/** Service Catalog — General Service Packages (doc §3). */
export const generalServicePackageInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(150),
  includedItems: z.array(z.string().trim().min(1)).default([]),
  serviceCharge: z.coerce.number().min(0, "Service charge must be zero or greater"),
  defaultItems: z.array(catalogDefaultItemInputSchema).default([]),
});

export type GeneralServicePackageInput = z.infer<typeof generalServicePackageInputSchema>;

/** Service Catalog — Specific Services (doc §3). defaultCharge is optional
 * (a suggested price, editable per job) — omitted means staff types a rate
 * fresh every time. */
export const specificServiceInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(150),
  defaultCharge: z.coerce.number().min(0, "Default charge must be zero or greater").optional(),
  defaultItems: z.array(catalogDefaultItemInputSchema).default([]),
});

export type SpecificServiceInput = z.infer<typeof specificServiceInputSchema>;
