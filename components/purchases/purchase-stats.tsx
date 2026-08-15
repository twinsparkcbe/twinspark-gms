import { Package, Receipt, Wallet } from "lucide-react";

import { formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PurchaseStats } from "@/services/purchases";

// Same local visual language as Inventory's stat cards (14px radius, thin
// neutral border) — see components/inventory/inventory-stats.tsx.
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

export function PurchaseStatsCards({ stats, isFiltered }: { stats: PurchaseStats; isFiltered?: boolean }) {
  const avgPerEntry = stats.entryCount > 0 ? stats.totalPurchaseAmount / stats.entryCount : 0;
  const period = isFiltered ? "(Filtered)" : "(This Month)";

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <StatCard
        icon={Wallet}
        iconClassName="bg-info/10 text-info"
        label={`Purchase Amount ${period}`}
        value={formatINR(stats.totalPurchaseAmount)}
      />
      <StatCard
        icon={Receipt}
        iconClassName="bg-neutral-100 text-neutral-600"
        label={isFiltered ? "Entries (Filtered)" : "Entries This Month"}
        value={stats.entryCount.toLocaleString("en-IN")}
      />
      <StatCard
        icon={Package}
        iconClassName="bg-success-bg text-success"
        label="Average per Entry"
        value={formatINR(avgPerEntry)}
      />
    </div>
  );
}
