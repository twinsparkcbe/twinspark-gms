import { CalendarCheck } from "lucide-react";

import { formatDate } from "@/lib/format";
import type { LastServiceSummary } from "@/services/service";

/**
 * Shown once a vehicle is resolved on the Service Job form (doc §2
 * addendum — "if old service done for the vehicle, last service date
 * needs to show"). Renders nothing while unresolved or when the vehicle
 * has no completed service on record — silence is the right default for a
 * brand-new bike, not a distracting "no history" banner.
 */
export function LastServiceHint({ summary }: { summary: LastServiceSummary | null }) {
  if (!summary) return null;

  return (
    <div className="flex items-center gap-1.5 rounded-[10px] border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
      <CalendarCheck className="size-3.5 shrink-0 text-neutral-400" />
      <span>
        Last service: <span className="font-medium text-neutral-900">{formatDate(summary.completedAt)}</span>
        {summary.invoiceNumber && <span className="text-neutral-400"> · Invoice {summary.invoiceNumber}</span>}
      </span>
    </div>
  );
}
