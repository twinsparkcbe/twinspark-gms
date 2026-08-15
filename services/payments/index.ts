/**
 * payments module — Payment QR Config (doc/payment-qr-config-scope.md).
 * Admin configures one active payment destination (QR image + UPI ID),
 * shown read-only on the public /order form above the screenshot upload.
 * Backed by the `payment_qr_configs` table (0030_payment_qr_config.sql).
 * Called by Server Actions (app/(app)/settings/payment/actions.ts and
 * app/order/page.tsx) via the plain RLS-scoped client (lib/supabase/
 * server.ts) — no service-role client needed here, unlike services/users.
 */
export * from "./qr-config";
export * from "./schemas";
