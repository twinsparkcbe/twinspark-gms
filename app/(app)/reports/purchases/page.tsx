import { requireAdmin } from "@/lib/auth/require-admin";
import { createClient } from "@/lib/supabase/server";
import { resolveDateRangePreset } from "@/services/dashboard/date-range";
import { getPurchaseStats, listPurchaseEntries } from "@/services/purchases";

import { PurchaseReportClient } from "@/components/reports/purchase-report-client";

const REPORT_PAGE_SIZE = 50;

export default async function PurchaseReportPage() {
  await requireAdmin();
  const supabase = await createClient();
  const { from, to } = resolveDateRangePreset("this_month");

  const [{ entries, total }, stats] = await Promise.all([
    listPurchaseEntries(supabase, { dateFrom: from, dateTo: to, page: 1, pageSize: REPORT_PAGE_SIZE }),
    getPurchaseStats(supabase, { from, to }),
  ]);

  return <PurchaseReportClient initialEntries={entries} initialTotal={total} initialStats={stats} />;
}
