import { requireAdmin } from "@/lib/auth/require-admin";
import { createClient } from "@/lib/supabase/server";
import { listFollowUpCandidates } from "@/services/reports";

import { CustomerFollowUpReportClient } from "@/components/reports/customer-followup-report-client";

// Not exported: Next.js App Router only allows a fixed set of named exports
// from a page.tsx file (default, metadata, generateStaticParams, etc.) —
// anything else fails the framework's own generated type check.
const DEFAULT_MONTHS_SINCE_SALE = 6;
const DEFAULT_MONTHS_SINCE_SERVICE = 3;

export default async function CustomerFollowUpReportPage() {
  await requireAdmin();
  const supabase = await createClient();

  const candidates = await listFollowUpCandidates(supabase, {
    monthsSinceSale: DEFAULT_MONTHS_SINCE_SALE,
    monthsSinceService: DEFAULT_MONTHS_SINCE_SERVICE,
  });

  return (
    <CustomerFollowUpReportClient
      initialCandidates={candidates}
      initialMonthsSinceSale={DEFAULT_MONTHS_SINCE_SALE}
      initialMonthsSinceService={DEFAULT_MONTHS_SINCE_SERVICE}
    />
  );
}
