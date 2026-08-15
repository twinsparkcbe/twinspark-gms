import { requireAdmin } from "@/lib/auth/require-admin";
import { createClient } from "@/lib/supabase/server";
import { getProfitTrend } from "@/services/reports";

import { ProfitReportClient } from "@/components/reports/profit-report-client";

// Same "fetch all three granularities upfront" pattern as Dashboard's chart
// and the Revenue Report — instant tab switching, no client round trip.
export default async function ProfitReportPage() {
  await requireAdmin();
  const supabase = await createClient();

  const [daily, weekly, monthly] = await Promise.all([
    getProfitTrend(supabase, "daily"),
    getProfitTrend(supabase, "weekly"),
    getProfitTrend(supabase, "monthly"),
  ]);

  return <ProfitReportClient daily={daily} weekly={weekly} monthly={monthly} />;
}
