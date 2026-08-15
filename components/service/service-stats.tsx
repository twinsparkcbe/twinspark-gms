import { IndianRupee, TrendingUp, Wrench } from "lucide-react";

import { formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ServiceStats } from "@/services/service";

const STAT_CARD_CLASS = "flex items-center gap-3 rounded-[14px] border border-neutral-200 bg-white p-4 shadow-sm";

function StatCard({
  icon: Icon,
  iconClassName,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconClassName: string;
  label: string;
  value: string;
}) {
  return (
    <div className={STAT_CARD_CLASS}>
      <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-[10px]", iconClassName)}>
        <Icon className="size-5" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-xl font-extrabold tracking-tight text-neutral-900">{value}</p>
        <p className="truncate text-xs font-medium text-neutral-500">{label}</p>
      </div>
    </div>
  );
}

// Only COMPLETED jobs ever count here (doc §23) — Draft/Cancelled jobs
// never touch these figures, and collectedRevenue splits out FREE_SERVICE
// jobs from what was actually meant to be collected.
export function ServiceStatsCards({ stats, isFiltered }: { stats: ServiceStats; isFiltered?: boolean }) {
  const period = isFiltered ? "(Filtered)" : "(This Month)";

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <StatCard icon={IndianRupee} iconClassName="bg-info/10 text-info" label={`Gross Revenue ${period}`} value={formatINR(stats.grossCompletedRevenue)} />
      <StatCard icon={TrendingUp} iconClassName="bg-success-bg text-success" label={`Collected Revenue ${period}`} value={formatINR(stats.collectedRevenue)} />
      <StatCard icon={Wrench} iconClassName="bg-neutral-100 text-neutral-600" label={isFiltered ? "Jobs Completed (Filtered)" : "Jobs Completed This Month"} value={stats.completedJobCount.toLocaleString("en-IN")} />
    </div>
  );
}
