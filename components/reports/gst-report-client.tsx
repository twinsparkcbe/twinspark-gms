"use client";

import { FileText, IndianRupee, Percent, Receipt } from "lucide-react";

import { formatDate, formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { GstReport, GstReportRow } from "@/services/reports";
import { Badge } from "@/components/ui/badge";
import { downloadXlsx, todayForFilename, type XlsxColumn } from "@/lib/xlsx-export";

import { fetchGstReportAction } from "@/app/(app)/reports/actions";

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

function formatGstRate(rate: number | null): string {
  return rate === null ? "—" : `${rate}%`;
}

// Date | Type | Invoice # | Customer | Taxable Value | GST Rate | GST Amount | Grand Total
const ROW_GRID_CLASS = "grid grid-cols-[95px_85px_110px_minmax(160px,1fr)_130px_85px_120px_130px] gap-3";

export function GstReportClient({ initialReport }: { initialReport: GstReport }) {
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
  } = useReportDateRange<GstReport>(initialReport, fetchGstReportAction);

  const GST_COLUMNS: XlsxColumn<GstReportRow>[] = [
    { header: "Date", accessor: (row) => formatDate(row.date) },
    { header: "Type", accessor: (row) => (row.type === "SALE" ? "Sale" : "Service") },
    { header: "Invoice #", accessor: (row) => row.invoiceNumber ?? "" },
    { header: "Customer", accessor: (row) => row.customerName },
    { header: "Taxable Value", accessor: (row) => row.taxableValue },
    { header: "GST Rate", accessor: (row) => (row.gstRate === null ? "" : row.gstRate) },
    { header: "GST Amount", accessor: (row) => row.gstAmount },
    { header: "Grand Total", accessor: (row) => row.grandTotal },
  ];

  function handleDownload() {
    downloadXlsx(`twinspark-gst-report-${todayForFilename()}`, "GST", GST_COLUMNS, data.rows);
  }

  return (
    <div className="space-y-6">
      <BackToReports />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-neutral-900">GST Report</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Every Sale and completed Service Job billed with GST — taxable value, rate, and tax collected, for filing.
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
          <DownloadXlsxButton onClick={handleDownload} disabled={data.rows.length === 0} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={IndianRupee}
          iconClassName="bg-neutral-100 text-neutral-600"
          label={`Taxable Value (${rangeLabel})`}
          value={formatINR(data.taxableValue)}
        />
        <StatCard
          icon={Percent}
          iconClassName="bg-info-bg text-info"
          label={`GST Collected (${rangeLabel})`}
          value={formatINR(data.gstAmount)}
        />
        <StatCard
          icon={Receipt}
          iconClassName="bg-success-bg text-success"
          label={`Total Invoice Value (${rangeLabel})`}
          value={formatINR(data.totalInvoiceValue)}
        />
        <StatCard
          icon={FileText}
          iconClassName="bg-warning/10 text-warning"
          label={`GST Bills (${rangeLabel})`}
          value={data.billCount.toLocaleString("en-IN")}
          hint="Sales + completed Service Jobs with GST applied"
        />
      </div>

      <div className="overflow-x-auto">
        <div role="table" aria-label="GST Report" aria-busy={isLoading} className="min-w-[1050px]">
          <div role="row" className={cn(ROW_GRID_CLASS, "px-4 py-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase")}>
            <span>Date</span>
            <span>Type</span>
            <span>Invoice #</span>
            <span>Customer</span>
            <span className="text-right">Taxable Value</span>
            <span className="text-right">GST Rate</span>
            <span className="text-right">GST Amount</span>
            <span className="text-right">Grand Total</span>
          </div>

          <div className={cn("flex flex-col gap-2", isLoading && "opacity-60 transition-opacity")}>
            {data.rows.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <Receipt className="size-10 text-neutral-300" />
                <p className="text-sm text-neutral-500">No GST-applicable bills in this period.</p>
              </div>
            )}

            {data.rows.map((row) => (
              <div key={row.id} role="row" className={cn(ROW_GRID_CLASS, "items-center rounded-[10px] border border-neutral-200 bg-white px-4 py-3 shadow-sm")}>
                <div role="cell" aria-label="Date" className="min-w-0 text-sm text-neutral-700">
                  {formatDate(row.date)}
                </div>
                <div role="cell" aria-label="Type" className="min-w-0">
                  <Badge variant={row.type === "SALE" ? "info" : "success"}>{row.type === "SALE" ? "Sale" : "Service"}</Badge>
                </div>
                <div role="cell" aria-label="Invoice number" className="min-w-0 truncate font-mono text-sm text-neutral-700">
                  {row.invoiceNumber ?? "—"}
                </div>
                <div role="cell" aria-label="Customer" className="min-w-0 truncate text-neutral-900">
                  {row.customerName}
                </div>
                <div role="cell" aria-label="Taxable value" className="min-w-0 text-right text-sm text-neutral-700">
                  {formatINR(row.taxableValue)}
                </div>
                <div role="cell" aria-label="GST rate" className="min-w-0 text-right text-sm text-neutral-700">
                  {formatGstRate(row.gstRate)}
                </div>
                <div role="cell" aria-label="GST amount" className="min-w-0 text-right text-sm text-neutral-700">
                  {formatINR(row.gstAmount)}
                </div>
                <div role="cell" aria-label="Grand total" className="min-w-0 text-right text-sm font-semibold text-neutral-900">
                  {formatINR(row.grandTotal)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
