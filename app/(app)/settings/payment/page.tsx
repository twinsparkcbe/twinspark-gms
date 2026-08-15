import { requireAdmin } from "@/lib/auth/require-admin";
import { createClient } from "@/lib/supabase/server";
import { listPaymentQrConfigs } from "@/services/payments";

import { PaymentConfigPageClient } from "@/components/settings/payment-config-page-client";

// Server-side Admin gate, same as every other Admin-only module page
// (e.g. app/(app)/settings/users/page.tsx).
export default async function PaymentSettingsPage() {
  await requireAdmin();
  const supabase = await createClient();

  const configs = await listPaymentQrConfigs(supabase);

  return <PaymentConfigPageClient initialConfigs={configs} />;
}
