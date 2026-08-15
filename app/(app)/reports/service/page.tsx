import { requireAdmin } from "@/lib/auth/require-admin";
import { createClient } from "@/lib/supabase/server";
import { resolveDateRangePreset } from "@/services/dashboard/date-range";
import { getServiceStats, listServiceJobs } from "@/services/service";

import { ServiceReportClient } from "@/components/reports/service-report-client";

const REPORT_PAGE_SIZE = 50;

export default async function ServiceReportPage() {
  await requireAdmin();
  const supabase = await createClient();
  const { from, to } = resolveDateRangePreset("this_month");

  const [{ jobs, total }, stats] = await Promise.all([
    listServiceJobs(supabase, { dateFrom: from, dateTo: to, page: 1, pageSize: REPORT_PAGE_SIZE }),
    getServiceStats(supabase, { from, to }),
  ]);

  return <ServiceReportClient initialJobs={jobs} initialTotal={total} initialStats={stats} />;
}
