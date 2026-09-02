import { requireAdmin } from "@/lib/auth/require-admin";
import { createClient } from "@/lib/supabase/server";
import { resolveDateRangePreset } from "@/services/dashboard/date-range";
import { getServiceProfitReport } from "@/services/reports";

import { ServiceProfitReportClient } from "@/components/reports/service-profit-report-client";

export default async function ServiceProfitReportPage() {
  await requireAdmin();
  const supabase = await createClient();
  const { from, to } = resolveDateRangePreset("this_month");

  const report = await getServiceProfitReport(supabase, { from, to });

  return <ServiceProfitReportClient initialReport={report} />;
}
