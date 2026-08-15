"use client";

import { Banknote, IndianRupee, Smartphone, TriangleAlert, Wallet } from "lucide-react";

import { formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CollectionsDayRow, CollectionsReport } from "@/services/reports";
import { downloadXlsx, todayForFilename, type XlsxColumn } from "@/lib/xlsx-export";

import { fetchCollectionsReportAction } from "@/app/(app)/reports/actions";

import { BackToReports } from "./back-to-reports";
import { DashboardDateRangeFilter } from "@/components/dashboard/dashboard-date-range-filter";
import { DownloadXlsxButton } from "./download-xlsx-button";
import { useReportDateRange } from "./use-report-date-range";

const STAT_CARD_CLASS = "rounded-xl border border-neutral-200 bg-white p-5 shadow-sm";

function StatCard({
  icon: Icon,
  iconClassName,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconClassName: string;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className={STAT_CARD_CLASS}>
      <div className="flex items-center gap-2">
        <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", iconClassName)}>
          <Icon className="size-4" />
        </div>
        <p className="text-sm font-medium text-neutral-500">{label}</p>
      </div>
      <p className="mt-3 text-2xl font-bold tracking-tight text-neutral-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-neutral-400">{hint}</p>}
    </div>
  );
}

// Date | Cash | UPI | Outstanding
const ROW_GRID_CLASS = "grid grid-cols-[minmax(140px,1fr)_140px_140px_140px] gap-3";

export function CollectionsReportClient({ initialReport }: { initialReport: CollectionsReport }) {
  const {
    preset,
    customFrom,
    customTo,
    data,
    rangeLabel,
    isLoading,
    canReset,
    setCustomFrom,
    setCustomTo,
    handlePresetChange,
    handleApplyCustom,
    handleReset,
  } = useReportDateRange<CollectionsReport>(initialReport, fetchCollectionsReportAction);

  const COLLECTIONS_COLUMNS: XlsxColumn<CollectionsDayRow>[] = [
    { header: "Date", accessor: (row) => row.label },
    { header: "Cash", accessor: (row) => row.cash },
    { header: "UPI", accessor: (row) => row.upi },
    { header: "Outstanding", accessor: (row) => row.outstanding },
  ];

  function handleDownload() {
    downloadXlsx(`twinspark-collections-report-${todayForFilename()}`, "Collections", COLLECTIONS_COLUMNS, data.days);
  }

  return (
    <div className="space-y-6">
      <BackToReports />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-neutral-900">Collections Report</h1>
          <p className="mt-1 text-sm text-neutral-500">
            How much actually came in, split by cash and UPI — for reconciling the cash box against the bank.
          </p>
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
          <DownloadXlsxButton onClick={handleDownload} disabled={data.days.length === 0} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Banknote}
          iconClassName="bg-success-bg text-success"
          label={`Cash collected (${rangeLabel})`}
          value={formatINR(data.cash)}
        />
        <StatCard
          icon={Smartphone}
          iconClassName="bg-info-bg text-info"
          label={`UPI collected (${rangeLabel})`}
          value={formatINR(data.upi)}
        />
        <StatCard
          icon={TriangleAlert}
          iconClassName="bg-danger-bg text-danger"
          label={`Outstanding (${rangeLabel})`}
          value={formatINR(data.outstanding)}
          hint="Billed but not yet collected"
        />
        <StatCard
          icon={IndianRupee}
          iconClassName="bg-neutral-100 text-neutral-600"
          label={`Total billed (${rangeLabel})`}
          value={formatINR(data.totalBilled)}
        />
      </div>

      {/* Shown only when there is something in it. Bills settled before the
          tender columns existed genuinely have no cash/UPI recorded, and
          folding them into cash would overstate the cash box by exactly the
          figure the owner is trying to reconcile. This bucket shrinks to zero
          on its own as old invoices age out of the reporting window. */}
      {data.unrecorded > 0 && (
        <div className="flex items-start gap-3 rounded-[10px] border border-neutral-200 bg-neutral-50 px-4 py-3">
          <Wallet className="mt-0.5 size-4 shrink-0 text-neutral-400" />
          <p className="text-sm text-neutral-600">
            <span className="font-semibold text-neutral-900">{formatINR(data.unrecorded)}</span> was settled without a
            payment method recorded — bills raised before cash/UPI tracking was added. It is not counted in Cash or UPI
            above.
          </p>
        </div>
      )}

      <div className="overflow-x-auto">
        <div role="table" aria-label="Collections Report" aria-busy={isLoading} className="min-w-[600px]">
          <div
            role="row"
            className={cn(ROW_GRID_CLASS, "px-4 py-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase")}
          >
            <span>Date</span>
            <span>Cash</span>
            <span>UPI</span>
            <span className="text-right">Outstanding</span>
          </div>

          <div className={cn("flex flex-col gap-2", isLoading && "opacity-60 transition-opacity")}>
            {data.days.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <Wallet className="size-10 text-neutral-300" />
                <p className="text-sm text-neutral-500">Nothing billed in this period.</p>
              </div>
            )}

            {data.days.map((row) => (
              <div
                key={row.date}
                role="row"
                className={cn(ROW_GRID_CLASS, "items-center rounded-[10px] border border-neutral-200 bg-white px-4 py-3 shadow-sm")}
              >
                <div role="cell" aria-label="Date" className="min-w-0 text-sm text-neutral-700">
                  {row.label}
                </div>
                <div role="cell" aria-label="Cash" className="min-w-0 text-sm font-medium text-neutral-900">
                  {formatINR(row.cash)}
                </div>
                <div role="cell" aria-label="UPI" className="min-w-0 text-sm font-medium text-neutral-900">
                  {formatINR(row.upi)}
                </div>
                <div
                  role="cell"
                  aria-label="Outstanding"
                  className={cn("text-right text-sm font-medium", row.outstanding > 0 ? "text-danger" : "text-neutral-400")}
                >
                  {formatINR(row.outstanding)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
