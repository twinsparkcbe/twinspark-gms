import { requireOnlineOrdersAccess } from "@/lib/auth/require-online-orders-access";
import { createClient } from "@/lib/supabase/server";
import { getOnlineOrderStats, listOnlineOrders } from "@/services/online-orders";

import { OnlineOrdersPageClient } from "@/components/online-orders/orders-page-client";

// Server-side guard (mirrors app/(app)/sales/page.tsx) — both Administrator
// and Sales Person get real access here, unlike Inventory/Purchases/Reports.
export default async function OnlineOrdersPage() {
  await requireOnlineOrdersAccess();
  const supabase = await createClient();

  const [{ orders, total }, stats] = await Promise.all([
    listOnlineOrders(supabase, { page: 1, pageSize: 20 }),
    getOnlineOrderStats(supabase),
  ]);

  return <OnlineOrdersPageClient initialOrders={orders} initialTotal={total} initialStats={stats} />;
}
