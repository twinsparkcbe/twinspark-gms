import { requireAdmin } from "@/lib/auth/require-admin";
import { createClient } from "@/lib/supabase/server";
import { resolveDateRangePreset } from "@/services/dashboard/date-range";
import { getGstReport } from "@/services/reports";

import { GstReportClient } from "@/components/reports/gst-report-client";

export default async function GstReportPage() {
  await requireAdmin();
  const supabase = await createClient();
  const { from, to } = resolveDateRangePreset("this_month");

  const report = await getGstReport(supabase, { from, to });

  return <GstReportClient initialReport={report} />;
}
