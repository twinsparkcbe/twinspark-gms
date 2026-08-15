import type { Metadata } from "next";

import { createClient } from "@/lib/supabase/server";
import { getActivePaymentQrConfig } from "@/services/payments";

import { BrandMark } from "@/components/shared/brand-mark";
import { PublicOrderForm } from "@/components/online-orders/public-order-form";

export const metadata: Metadata = {
  title: "Order Track Tyres — Twinspark",
  description: "Order Track Tyres online from Twinspark Tyres And Bike Garage, Coimbatore.",
};

// Public, unauthenticated Track Tyre order form — no requireAdmin/
// requireOnlineOrdersAccess guard here by design (doc/online-orders-scope.md
// §1), and "/order" is added to PUBLIC_PATHS in lib/supabase/middleware.ts
// so unauthenticated visitors aren't redirected to /login.
export default async function PublicOrderPage() {
  // Fetched server-side (not via a Server Action) so the payment card is in
  // the form's first paint with no loading flash — createClient() already
  // forces dynamic rendering via cookies(), so this is never stale-cached.
  // getActivePaymentQrConfig() is safe to call with no session: its RLS
  // policy lets anon read only the single active row
  // (0030_payment_qr_config.sql), same shape as getTrackTyrePrices().
  const supabase = await createClient();
  const paymentConfig = await getActivePaymentQrConfig(supabase);

  return (
    <div className="flex flex-col items-center">
      <BrandMark variant="login" className="mb-6" />
      <h1 className="text-center text-2xl font-black tracking-tight text-neutral-900">Order Track Tyres</h1>
      <p className="mt-1 text-center text-sm text-neutral-600">
        Fill in your details and upload your payment screenshot — we&apos;ll verify it and get your order moving.
      </p>

      <div className="mt-8 w-full rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <PublicOrderForm paymentConfig={paymentConfig} />
      </div>
    </div>
  );
}
