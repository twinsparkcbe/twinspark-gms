import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import type { OpenWorkCounts, StockAlertGroup, StockAlerts } from "@/services/dashboard/stats";

const PREVIEW_COUNT = 3;

/**
 * Replaces the old Low Stock Alerts card. That card merged low-stock and
 * out-of-stock into one flat list, so an item sitting at 0 looked exactly like
 * an item sitting at 2 — the genuinely urgent case was invisible. Here the two
 * are separate tinted blocks ranked by urgency, with the owner's open work
 * queue underneath (doc/dashboard-redesign-scope.md §3e).
 */

function StockBlock({
  group,
  tone,
  headline,
  href,
}: {
  group: StockAlertGroup;
  tone: "danger" | "warning";
  headline: (count: number) => string;
  href: string;
}) {
  if (group.totalCount === 0) return null;

  const preview = group.items.slice(0, PREVIEW_COUNT);
  const remaining = group.totalCount - preview.length;

  return (
    <Link
      href={href}
      className={cn(
        "block rounded-[10px] p-3 transition-opacity hover:opacity-80",
        tone === "danger" ? "bg-danger-bg" : "bg-warning/10"
      )}
    >
      <p className={cn("text-sm font-bold", tone === "danger" ? "text-danger" : "text-warning")}>
        {headline(group.totalCount)}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-neutral-600">
        {preview.map((item) => item.productName).join(" · ")}
        {remaining > 0 && <span className="font-medium"> +{remaining} more</span>}
      </p>
    </Link>
  );
}

function OpenWorkRow({ label, count, href }: { label: string; count: number; href: string }) {
  return (
    <Link
      href={href}
      className="group flex items-center justify-between gap-2 rounded-[10px] px-2 py-1.5 transition-colors hover:bg-neutral-50"
    >
      <span className="min-w-0 truncate text-sm text-neutral-600 group-hover:text-neutral-900">{label}</span>
      <span className="flex shrink-0 items-center gap-1">
        <span className="text-sm font-bold text-neutral-900">{count.toLocaleString("en-IN")}</span>
        <ChevronRight className="size-4 text-neutral-300 group-hover:text-neutral-400" aria-hidden="true" />
      </span>
    </Link>
  );
}

export function NeedsAttentionPanel({
  alerts,
  openWork,
}: {
  alerts: StockAlerts;
  openWork: OpenWorkCounts;
}) {
  const nothingPending =
    alerts.outOfStock.totalCount === 0 &&
    alerts.lowStock.totalCount === 0 &&
    openWork.ordersToDispatch === 0 &&
    openWork.openServiceJobs === 0;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <AlertTriangle
          className={cn("size-4 shrink-0", nothingPending ? "text-neutral-300" : "text-danger")}
          aria-hidden="true"
        />
        <h2 className="text-sm font-bold text-neutral-900">Needs attention</h2>
      </div>

      {nothingPending ? (
        // One calm line, not three empty blocks — an all-clear state
        // shouldn't look like a panel that failed to load.
        <div className="flex flex-col items-center gap-1.5 py-6 text-center">
          <CheckCircle2 className="size-6 text-success" aria-hidden="true" />
          <p className="text-xs text-neutral-500">All clear — nothing waiting on you.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          <StockBlock
            group={alerts.outOfStock}
            tone="danger"
            headline={(n) => `${n} ${n === 1 ? "item" : "items"} out of stock`}
            href="/inventory?stockStatus=out_of_stock"
          />
          <StockBlock
            group={alerts.lowStock}
            tone="warning"
            headline={(n) => `${n} ${n === 1 ? "item" : "items"} running low`}
            href="/inventory?stockStatus=low_stock"
          />

          {(openWork.ordersToDispatch > 0 || openWork.openServiceJobs > 0) && (
            <div className="border-t border-neutral-100 pt-2">
              {openWork.ordersToDispatch > 0 && (
                <OpenWorkRow label="Orders to dispatch" count={openWork.ordersToDispatch} href="/online-orders" />
              )}
              {openWork.openServiceJobs > 0 && (
                <OpenWorkRow label="Service jobs open" count={openWork.openServiceJobs} href="/service" />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
