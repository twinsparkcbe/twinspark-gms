import { requireAdmin } from "@/lib/auth/require-admin";
import { createClient } from "@/lib/supabase/server";
import { resolveDateRangePreset } from "@/services/dashboard/date-range";
import { getOnlineOrdersReportStats } from "@/services/online-orders";

import { OnlineOrdersReportClient } from "@/components/reports/online-orders-report-client";

export default async function OnlineOrdersReportPage() {
  await requireAdmin();
  const supabase = await createClient();
  const { from, to } = resolveDateRangePreset("this_month");

  const stats = await getOnlineOrdersReportStats(supabase, { from, to });

  return <OnlineOrdersReportClient initialStats={stats} />;
}
