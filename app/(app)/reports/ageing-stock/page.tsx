import { requireAdmin } from "@/lib/auth/require-admin";
import { createClient } from "@/lib/supabase/server";
import { listAgeingStock } from "@/services/reports";

import { AgeingStockReportClient } from "@/components/reports/ageing-stock-report-client";

// Not exported: Next.js App Router only allows a fixed set of named exports
// from a page.tsx file (default, metadata, generateStaticParams, etc.) —
// anything else fails the framework's own generated type check.
const DEFAULT_AGEING_MONTHS = 6;

export default async function AgeingStockReportPage() {
  await requireAdmin();
  const supabase = await createClient();

  const rows = await listAgeingStock(supabase, DEFAULT_AGEING_MONTHS);

  return <AgeingStockReportClient initialRows={rows} initialMonthsThreshold={DEFAULT_AGEING_MONTHS} />;
}
