import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Same back-button convention already used on print-style views
 * (job-card-view.tsx, sales-invoice-view.tsx, etc.) — every individual
 * Report page gets one back to the Reports landing page. */
export function BackToReports() {
  return (
    <Button asChild variant="secondary" size="sm" className="rounded-[10px]">
      <Link href="/reports">
        <ArrowLeft className="size-4" />
        Back to Reports
      </Link>
    </Button>
  );
}
