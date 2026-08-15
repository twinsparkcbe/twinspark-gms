import { z } from "zod";

// name@handle — e.g. "twinspark@okhdfcbank", "9876543210@ybl". Deliberately
// permissive on the handle portion (real-world UPI handles vary a lot:
// bank-issued, PSP-issued, custom) rather than an exhaustive allow-list of
// known handles, which would go stale the moment a new PSP launches.
const UPI_ID_REGEX = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9.\-]{1,64}$/;

export const upiIdSchema = z
  .string()
  .trim()
  .min(1, "UPI ID is required")
  .regex(UPI_ID_REGEX, "Enter a valid UPI ID (e.g. name@bank)");

/**
 * Payment QR Config — Admin-only, Settings / Payment (doc/payment-qr-config-
 * scope.md). `qrImagePath` isn't part of this schema: the image is uploaded
 * separately first (uploadPaymentQrImage in ./qr-config.ts, same two-step
 * shape as every other image-upload flow in this app) and its returned path
 * is passed in alongside the rest of the fields.
 */
export const paymentQrConfigInputSchema = z.object({
  label: z.string().trim().min(1, "Label is required").max(100),
  upiId: upiIdSchema,
  payeeName: z.string().trim().min(1, "Payee name is required").max(150),
  qrImagePath: z.string().trim().min(1, "A QR image is required"),
});

export type PaymentQrConfigInput = z.infer<typeof paymentQrConfigInputSchema>;
