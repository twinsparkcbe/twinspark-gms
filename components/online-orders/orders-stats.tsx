import { CheckCircle2, PackageCheck, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import type { OnlineOrderStats } from "@/services/online-orders";

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

// Current queue-depth snapshot, not a date-ranged money total (an online
// order has no invoice amount of its own — see getOnlineOrderStats' doc
// comment) — "how many need my attention right now."
export function OnlineOrderStatsCards({ stats }: { stats: OnlineOrderStats }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <StatCard
        icon={ShieldCheck}
        iconClassName="bg-warning/10 text-warning"
        label="Awaiting Payment Verification"
        value={stats.submittedCount.toLocaleString("en-IN")}
      />
      <StatCard
        icon={CheckCircle2}
        iconClassName="bg-info-bg text-info"
        label="Awaiting Approval"
        value={stats.paymentVerifiedCount.toLocaleString("en-IN")}
      />
      <StatCard
        icon={PackageCheck}
        iconClassName="bg-success-bg text-success"
        label="Awaiting Dispatch"
        value={stats.approvedCount.toLocaleString("en-IN")}
      />
    </div>
  );
}
