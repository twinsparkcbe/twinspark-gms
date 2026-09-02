"use client";

import { Gift, IndianRupee, Package, TrendingUp, Wrench } from "lucide-react";

import { formatDate, formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ServiceProfitJobRow, ServiceProfitReport } from "@/services/reports";
import { downloadXlsx, todayForFilename, type XlsxColumn } from "@/lib/xlsx-export";

import { fetchServiceProfitReportAction } from "@/app/(app)/reports/actions";

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
  valueClassName,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconClassName: string;
  label: string;
  value: string;
  hint?: string;
  valueClassName?: string;
}) {
  return (
    <div className={STAT_CARD_CLASS}>
      <div className="flex items-center gap-2">
        <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", iconClassName)}>
          <Icon className="size-4" />
        </div>
        <p className="text-sm font-medium text-neutral-500">{label}</p>
      </div>
      <p className={cn("mt-3 text-2xl font-bold tracking-tight text-neutral-900", valueClassName)}>{value}</p>
      {hint && <p className="mt-1 text-xs text-neutral-400">{hint}</p>}
    </div>
  );
}

/** A loss is money, not a formatting edge case — shown as −₹1,900 in red
 * rather than as a bare negative that reads like a typo. */
function SignedINR({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn(value < 0 ? "text-danger" : "text-neutral-900", className)}>
      {value < 0 ? `−${formatINR(Math.abs(value))}` : formatINR(value)}
    </span>
  );
}

// Date | Job # | Customer / Vehicle | Labour | Parts Sold | Parts Cost | Discount | Profit
const ROW_GRID_CLASS = "grid grid-cols-[95px_105px_minmax(160px,1fr)_110px_110px_110px_100px_120px] gap-3";

export function ServiceProfitReportClient({ initialReport }: { initialReport: ServiceProfitReport }) {
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
  } = useReportDateRange<ServiceProfitReport>(initialReport, fetchServiceProfitReportAction);

  const COLUMNS: XlsxColumn<ServiceProfitJobRow>[] = [
    { header: "Date", accessor: (row) => formatDate(row.completedAt) },
    { header: "Job #", accessor: (row) => row.jobNumber },
    { header: "Invoice #", accessor: (row) => row.invoiceNumber ?? "" },
    { header: "Customer", accessor: (row) => row.customerName },
    { header: "Vehicle", accessor: (row) => row.vehicleNumber },
    { header: "Labour & Services", accessor: (row) => row.labourRevenue },
    { header: "Parts Sold", accessor: (row) => row.partsRevenue },
    { header: "Parts Cost", accessor: (row) => row.partsCost },
    { header: "Discount", accessor: (row) => row.discount },
    { header: "GST", accessor: (row) => row.gstAmount },
    { header: "Profit", accessor: (row) => row.profit },
    { header: "Free Service", accessor: (row) => (row.isFreeService ? "Yes" : "") },
    { header: "Cost Estimated", accessor: (row) => (row.costIsEstimated ? "Yes" : "") },
  ];

  function handleDownload() {
    downloadXlsx(`twinspark-service-profit-${todayForFilename()}`, "Service Profit", COLUMNS, data.jobs);
  }

  return (
    <div className="space-y-6">
      <BackToReports />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-neutral-900">Service Profit</h1>
          <p className="mt-1 text-sm text-neutral-500">
            What service work earns once the spares it used are paid for. Labour and services carry no stock, so they are
            profit in full; parts earn only what they were billed above cost. GST is excluded — it is collected for the
            government, not earned.
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
          <DownloadXlsxButton onClick={handleDownload} disabled={data.jobs.length === 0} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          icon={TrendingUp}
          iconClassName="bg-success-bg text-success"
          label={`Service Profit (${rangeLabel})`}
          value={data.totalProfit < 0 ? `−${formatINR(Math.abs(data.totalProfit))}` : formatINR(data.totalProfit)}
          valueClassName={data.totalProfit < 0 ? "text-danger" : "text-success"}
          hint={`${data.jobCount.toLocaleString("en-IN")} completed job${data.jobCount === 1 ? "" : "s"}`}
        />
        <StatCard
          icon={Wrench}
          iconClassName="bg-info-bg text-info"
          label="Labour & Services"
          value={formatINR(data.labourRevenue)}
          hint="No stock behind these — profit in full"
        />
        <StatCard
          icon={Package}
          iconClassName="bg-warning/10 text-warning"
          label="Parts Profit"
          value={data.partsProfit < 0 ? `−${formatINR(Math.abs(data.partsProfit))}` : formatINR(data.partsProfit)}
          valueClassName={data.partsProfit < 0 ? "text-danger" : undefined}
          hint={`${formatINR(data.partsRevenue)} sold − ${formatINR(data.partsCost)} cost`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Package} iconClassName="bg-neutral-100 text-neutral-600" label="Spares Sold" value={formatINR(data.partsRevenue)} hint="Billed to customers" />
        <StatCard icon={IndianRupee} iconClassName="bg-neutral-100 text-neutral-600" label="Spares Cost" value={formatINR(data.partsCost)} hint="What those exact units cost the shop" />
        <StatCard icon={IndianRupee} iconClassName="bg-neutral-100 text-neutral-600" label="Discount Given" value={formatINR(data.discountTotal)} hint={`GST collected ${formatINR(data.gstCollected)}, not counted as profit`} />
        <StatCard
          icon={Gift}
          iconClassName="bg-neutral-100 text-neutral-600"
          label="Free Service Jobs"
          value={data.freeServiceJobCount.toLocaleString("en-IN")}
          hint={data.freeServiceJobCount > 0 ? `${formatINR(data.freeServiceCost)} of parts given away` : "None in this period"}
        />
      </div>

      {data.estimatedCostJobCount > 0 && (
        <p className="rounded-[10px] border border-warning/40 bg-warning/5 px-4 py-3 text-xs text-neutral-600">
          {data.estimatedCostJobCount.toLocaleString("en-IN")} job
          {data.estimatedCostJobCount === 1 ? "" : "s"} in this period predate per-job cost tracking, or were edited after
          being billed. Their spares cost is estimated from the item&rsquo;s purchase price and is marked{" "}
          <span className="font-semibold">est.</span> in the table. Everything else is the exact batch cost.
        </p>
      )}

      <div className="overflow-x-auto">
        <div role="table" aria-label="Service Profit" aria-busy={isLoading} className="min-w-[1000px]">
          <div role="row" className={cn(ROW_GRID_CLASS, "px-4 py-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase")}>
            <span>Date</span>
            <span>Job #</span>
            <span>Customer / Vehicle</span>
            <span className="text-right">Labour</span>
            <span className="text-right">Parts Sold</span>
            <span className="text-right">Parts Cost</span>
            <span className="text-right">Discount</span>
            <span className="text-right">Profit</span>
          </div>

          <div className={cn("flex flex-col gap-2", isLoading && "opacity-60 transition-opacity")}>
            {data.jobs.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <Wrench className="size-10 text-neutral-300" />
                <p className="text-sm text-neutral-500">No completed service jobs in this period.</p>
              </div>
            )}

            {data.jobs.map((job) => (
              <div
                key={job.id}
                role="row"
                className={cn(ROW_GRID_CLASS, "items-center rounded-[10px] border border-neutral-200 bg-white px-4 py-3 shadow-sm")}
              >
                <div role="cell" aria-label="Date" className="min-w-0 text-sm text-neutral-700">
                  {formatDate(job.completedAt)}
                </div>
                <div role="cell" aria-label="Job number" className="min-w-0">
                  <div className="truncate font-mono text-sm text-neutral-700">{job.jobNumber}</div>
                  {job.invoiceNumber && <div className="truncate font-mono text-[11px] text-neutral-400">{job.invoiceNumber}</div>}
                </div>
                <div role="cell" aria-label="Customer / Vehicle" className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-neutral-900">{job.customerName}</span>
                    {job.isFreeService && (
                      <span className="shrink-0 rounded-full bg-info-bg px-2 py-0.5 text-[10px] font-semibold text-info uppercase">Free</span>
                    )}
                  </div>
                  <div className="truncate font-mono text-[11px] text-neutral-500">{job.vehicleNumber}</div>
                </div>
                <div role="cell" aria-label="Labour" className="min-w-0 text-right text-sm text-neutral-700">
                  {formatINR(job.labourRevenue)}
                </div>
                <div role="cell" aria-label="Parts sold" className="min-w-0 text-right text-sm text-neutral-700">
                  {formatINR(job.partsRevenue)}
                </div>
                <div role="cell" aria-label="Parts cost" className="min-w-0 text-right text-sm text-neutral-700">
                  {formatINR(job.partsCost)}
                  {job.costIsEstimated && <span className="ml-1 text-[10px] text-warning">est.</span>}
                </div>
                <div role="cell" aria-label="Discount" className="min-w-0 text-right text-sm text-neutral-700">
                  {job.discount > 0 ? `−${formatINR(job.discount)}` : "—"}
                </div>
                <div role="cell" aria-label="Profit" className="min-w-0 text-right text-sm font-semibold">
                  <SignedINR value={job.profit} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
