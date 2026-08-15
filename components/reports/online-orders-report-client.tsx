"use client";

import { CheckCircle2, IndianRupee, Send, XCircle } from "lucide-react";

import { formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { OnlineOrdersReportStats } from "@/services/online-orders";
import { downloadXlsx, todayForFilename, type XlsxColumn } from "@/lib/xlsx-export";

import { fetchOnlineOrdersReportAction } from "@/app/(app)/reports/actions";

import { BackToReports } from "./back-to-reports";
import { DashboardDateRangeFilter } from "@/components/dashboard/dashboard-date-range-filter";
import { DownloadXlsxButton } from "./download-xlsx-button";
import { useReportDateRange } from "./use-report-date-range";

const STAT_CARD_CLASS = "rounded-xl border border-neutral-200 bg-white p-5 shadow-sm";

function StatCard({ icon: Icon, iconClassName, label, value }: { icon: React.ComponentType<{ className?: string }>; iconClassName: string; label: string; value: string }) {
  return (
    <div className={STAT_CARD_CLASS}>
      <div className="flex items-center gap-2">
        <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", iconClassName)}>
          <Icon className="size-4" />
        </div>
        <p className="text-sm font-medium text-neutral-500">{label}</p>
      </div>
      <p className="mt-3 text-2xl font-bold tracking-tight text-neutral-900">{value}</p>
    </div>
  );
}

export function OnlineOrdersReportClient({ initialStats }: { initialStats: OnlineOrdersReportStats }) {
  const { preset, customFrom, customTo, data, rangeLabel, isLoading, canReset, setCustomFrom, setCustomTo, handlePresetChange, handleApplyCustom, handleReset } = useReportDateRange<OnlineOrdersReportStats>(
    initialStats,
    fetchOnlineOrdersReportAction
  );

  const SUMMARY_COLUMNS: XlsxColumn<{ metric: string; value: number }>[] = [
    { header: "Metric", accessor: (row) => row.metric },
    { header: "Value", accessor: (row) => row.value },
  ];

  function handleDownload() {
    const rows = [
      { metric: `Submitted (${rangeLabel})`, value: data.submittedCount },
      { metric: `Dispatched (${rangeLabel})`, value: data.dispatchedCount },
      { metric: `Dispatched Amount (${rangeLabel})`, value: data.dispatchedAmount },
      { metric: `Rejected (${rangeLabel})`, value: data.rejectedCount },
    ];
    downloadXlsx(`twinspark-online-orders-report-${todayForFilename()}`, "Online Orders", SUMMARY_COLUMNS, rows);
  }

  return (
    <div className="space-y-6">
      <BackToReports />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-neutral-900">Online Orders Report</h1>
          <p className="mt-1 text-sm text-neutral-500">Track Tyre online channel volume, dispatch, and rejections.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DashboardDateRangeFilter
            preset={preset}
            customFrom={customFrom}
            customTo={customTo}
            isLoading={isLoading}
            canReset={canReset}
            onPresetChange={handlePresetChange}
            onCustomFromChange={setCustomFrom}
            onCustomToChange={setCustomTo}
            onApplyCustom={handleApplyCustom}
            onReset={handleReset}
          />
          <DownloadXlsxButton onClick={handleDownload} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Send} iconClassName="bg-info-bg text-info" label={`Submitted (${rangeLabel})`} value={data.submittedCount.toLocaleString("en-IN")} />
        <StatCard icon={CheckCircle2} iconClassName="bg-success-bg text-success" label={`Dispatched (${rangeLabel})`} value={data.dispatchedCount.toLocaleString("en-IN")} />
        <StatCard icon={IndianRupee} iconClassName="bg-success-bg text-success" label={`Dispatched Amount (${rangeLabel})`} value={formatINR(data.dispatchedAmount)} />
        <StatCard icon={XCircle} iconClassName="bg-danger-bg text-danger" label={`Rejected (${rangeLabel})`} value={data.rejectedCount.toLocaleString("en-IN")} />
      </div>

      <p className="text-xs text-neutral-400">
        Full order list, live queue depth, and courier labels stay on the Online Orders module itself — this report is the
        period-over-period summary.
      </p>
    </div>
  );
}
