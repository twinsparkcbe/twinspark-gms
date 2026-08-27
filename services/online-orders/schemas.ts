import { z } from "zod";

import { mobileNumberSchema } from "@/services/shared/mobile";

export const ONLINE_ORDER_STATUS_VALUES = [
  "SUBMITTED",
  "PAYMENT_VERIFIED",
  "APPROVED",
  "DISPATCHED",
  "REJECTED",
] as const;

export const ONLINE_ORDER_SORT_OPTIONS = ["newest", "oldest"] as const;
export type OnlineOrderSort = (typeof ONLINE_ORDER_SORT_OPTIONS)[number];

const PIN_CODE_REGEX = /^[0-9]{6}$/;

/** Absolute client-side ceiling on a customer-entered amount. The real,
 * order-aware limit (3x the catalogue value) is enforced by
 * submit_online_order() — a client-side cap can always be bypassed, so this
 * one only exists to give a typo instant feedback instead of a round trip. */
export const MAX_QUOTED_AMOUNT = 100000;

/** Standalone field schemas — exported so the public order form (a Client
 * Component) can re-validate individual fields on the client with the exact
 * same rule as the server, without depending on `.shape` of the full
 * submitOnlineOrderInputSchema (which is a ZodEffects after superRefine and
 * doesn't expose `.shape`).
 *
 * The mobile rule now comes from services/shared/mobile — the same one Sales
 * and Service use, so a customer who orders online and later walks into the
 * shop is stored under an identically-formatted number (it's the
 * find-or-create key in every module). */
export { mobileNumberSchema };
export const pinCodeSchema = z.string().trim().regex(PIN_CODE_REGEX, "PIN code must be exactly 6 digits");

/**
 * Public order submission form (doc/online-orders-scope.md §1). No
 * customerId/session concept — this is deliberately the app's first
 * anonymous write path, so every field is re-validated server-side (never
 * trust the client), same as every other module's input schema.
 *
 * quantityFront/quantityBack (§0): replaces the spec's single "quantity"
 * field now that Track Tyre Front/Back are separate inventory rows — at
 * least one must be positive, checked via superRefine since neither field
 * alone is required.
 */
export const submitOnlineOrderInputSchema = z
  .object({
    customerName: z.string().trim().min(1, "Customer name is required").max(150),
    mobileNumber: mobileNumberSchema,
    address: z.string().trim().min(1, "Address is required").max(300),
    pinCode: pinCodeSchema,
    quantityFront: z.coerce
      .number()
      .int("Quantity must be a whole number")
      .min(0, "Quantity cannot be negative")
      .default(0),
    quantityBack: z.coerce
      .number()
      .int("Quantity must be a whole number")
      .min(0, "Quantity cannot be negative")
      .default(0),
    /** Storage path returned by uploadPaymentScreenshot(), not a raw File —
     * the file itself is uploaded first (see services/online-orders/orders.ts). */
    paymentScreenshotPath: z.string().trim().min(1, "A payment screenshot is required"),
    /**
     * The amount the customer was quoted over the phone/WhatsApp, when it
     * differs from the catalogue total (0036_online_order_amount_override.sql).
     * Optional: omitted means "charge the catalogue price", which is what
     * every order did before this field existed.
     *
     * This is the only money figure the client may influence anywhere in the
     * app, and /order is anonymous, so the real bounds live in Postgres —
     * this schema only stops obvious garbage from making the round trip.
     */
    quotedAmount: z.coerce
      .number()
      .positive("Amount must be greater than zero")
      .max(MAX_QUOTED_AMOUNT, "Enter the amount you were quoted")
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.quantityFront === 0 && value.quantityBack === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quantityFront"],
        message: "Order at least one Track Tyre (Front or Back)",
      });
    }
  });

export type SubmitOnlineOrderInput = z.infer<typeof submitOnlineOrderInputSchema>;

export const rejectOnlineOrderInputSchema = z.object({
  orderId: z.string().uuid(),
  reason: z.string().trim().min(1, "A reason is required"),
});

export type RejectOnlineOrderInput = z.infer<typeof rejectOnlineOrderInputSchema>;

export const onlineOrderFiltersSchema = z.object({
  // Matches customer name or mobile number.
  search: z.string().trim().optional(),
  statuses: z.array(z.enum(ONLINE_ORDER_STATUS_VALUES)).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  sortBy: z.enum(ONLINE_ORDER_SORT_OPTIONS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type OnlineOrderFilters = z.infer<typeof onlineOrderFiltersSchema>;
