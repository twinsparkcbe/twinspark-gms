import { requireAdmin } from "@/lib/auth/require-admin";
import { createClient } from "@/lib/supabase/server";
import { resolveDateRangePreset } from "@/services/dashboard/date-range";
import { getSalesStats, listSales } from "@/services/sales";

import { SalesReportClient } from "@/components/reports/sales-report-client";

const REPORT_PAGE_SIZE = 50;

export default async function SalesReportPage() {
  await requireAdmin();
  const supabase = await createClient();
  const { from, to } = resolveDateRangePreset("this_month");

  const [{ sales, total }, stats] = await Promise.all([
    listSales(supabase, { dateFrom: from, dateTo: to, page: 1, pageSize: REPORT_PAGE_SIZE }),
    getSalesStats(supabase, { from, to }),
  ]);

  return <SalesReportClient initialSales={sales} initialTotal={total} initialStats={stats} />;
}
