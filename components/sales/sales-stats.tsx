import { Receipt, TrendingUp, Wallet } from "lucide-react";

import { formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SalesStats } from "@/services/sales";

// Same local visual language as Inventory/Purchases' stat cards (14px
// radius, thin neutral border) — see components/inventory/inventory-stats.tsx.
const STAT_CARD_CLASS =
  "flex items-center gap-3 rounded-[14px] border border-neutral-200 bg-white p-4 shadow-sm";

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

export function SalesStatsCards({ stats, isFiltered }: { stats: SalesStats; isFiltered?: boolean }) {
  const avgPerSale = stats.saleCount > 0 ? stats.totalSalesAmount / stats.saleCount : 0;
  const period = isFiltered ? "(Filtered)" : "(This Month)";

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <StatCard
        icon={Wallet}
        iconClassName="bg-info/10 text-info"
        label={`Sales Amount ${period}`}
        value={formatINR(stats.totalSalesAmount)}
      />
      <StatCard
        icon={Receipt}
        iconClassName="bg-neutral-100 text-neutral-600"
        label={isFiltered ? "Sales (Filtered)" : "Sales This Month"}
        value={stats.saleCount.toLocaleString("en-IN")}
      />
      <StatCard
        icon={TrendingUp}
        iconClassName="bg-success-bg text-success"
        label="Average per Sale"
        value={formatINR(avgPerSale)}
      />
    </div>
  );
}
