import { requireAdmin } from "@/lib/auth/require-admin";
import { createClient } from "@/lib/supabase/server";
import { resolveDateRangePreset } from "@/services/dashboard/date-range";
import { getCollectionsReport } from "@/services/reports";

import { CollectionsReportClient } from "@/components/reports/collections-report-client";

export default async function CollectionsReportPage() {
  await requireAdmin();
  const supabase = await createClient();
  const { from, to } = resolveDateRangePreset("this_month");

  const report = await getCollectionsReport(supabase, { from, to });

  return <CollectionsReportClient initialReport={report} />;
}
