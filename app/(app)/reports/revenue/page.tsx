import { requireAdmin } from "@/lib/auth/require-admin";
import { createClient } from "@/lib/supabase/server";
import { getRevenueTrend } from "@/services/reports";

import { RevenueReportClient } from "@/components/reports/revenue-report-client";

// All three granularities are fetched upfront (each a tiny 6-14 point
// result) so the Daily/Weekly/Monthly tab switch is instant, client-side —
// same call as Dashboard's Track Tyre Sales chart (doc/dashboard-scope.md).
export default async function RevenueReportPage() {
  await requireAdmin();
  const supabase = await createClient();

  const [daily, weekly, monthly] = await Promise.all([
    getRevenueTrend(supabase, "daily"),
    getRevenueTrend(supabase, "weekly"),
    getRevenueTrend(supabase, "monthly"),
  ]);

  return <RevenueReportClient daily={daily} weekly={weekly} monthly={monthly} />;
}
