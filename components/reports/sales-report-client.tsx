"use client";

import { useMemo } from "react";
import { IndianRupee, Receipt } from "lucide-react";

import { formatDate, formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ITEM_TYPE_LABELS } from "@/components/inventory/constants";
import type { SaleRow, SalesStats } from "@/services/sales";
import type { ItemType } from "@/types/database.types";
import { downloadXlsxWorkbook, toSheetData, todayForFilename, type XlsxColumn } from "@/lib/xlsx-export";

import { fetchSalesReportAction, type SalesReportData } from "@/app/(app)/reports/actions";

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

function itemsSummary(sale: SaleRow): string {
  const productLines = sale.lineItems.filter((l) => l.lineType === "PRODUCT");
  if (productLines.length === 0) return "—";
  const first = productLines[0];
  const extra = productLines.length - 1;
  const label = `${first.itemName ?? "Item"}${first.quantity ? ` x${first.quantity}` : ""}`;
  return extra > 0 ? `${label} +${extra} more` : label;
}

/** Revenue by item type (doc/reports-scope.md §3) — computed from whatever
 * sales are currently loaded, using the itemType now carried on every
 * PRODUCT line (added alongside this module). */
function revenueByItemType(sales: SaleRow[]): { itemType: ItemType; amount: number }[] {
  const totals = new Map<ItemType, number>();
  for (const sale of sales) {
    for (const line of sale.lineItems) {
      if (line.lineType !== "PRODUCT" || !line.itemType) continue;
      totals.set(line.itemType, (totals.get(line.itemType) ?? 0) + (line.lineTotal ?? 0));
    }
  }
  return [...totals.entries()].map(([itemType, amount]) => ({ itemType, amount })).sort((a, b) => b.amount - a.amount);
}

// Date | Customer | Invoice # | Items | Amount
const ROW_GRID_CLASS = "grid grid-cols-[100px_minmax(160px,220px)_130px_minmax(200px,1fr)_130px] gap-3";

export function SalesReportClient({ initialSales, initialTotal, initialStats }: { initialSales: SaleRow[]; initialTotal: number; initialStats: SalesStats }) {
  const { preset, customFrom, customTo, data, rangeLabel, isLoading, canReset, setCustomFrom, setCustomTo, handlePresetChange, handleApplyCustom, handleReset } = useReportDateRange<SalesReportData>(
    { sales: initialSales, total: initialTotal, stats: initialStats },
    fetchSalesReportAction
  );

  const breakdown = useMemo(() => revenueByItemType(data.sales), [data.sales]);

  const SALES_COLUMNS: XlsxColumn<SaleRow>[] = [
    { header: "Date", accessor: (sale) => formatDate(sale.saleDate) },
    { header: "Customer", accessor: (sale) => sale.customerName },
    { header: "Mobile", accessor: (sale) => sale.customerMobile },
    { header: "Invoice #", accessor: (sale) => sale.invoiceNumber },
    { header: "Items", accessor: (sale) => itemsSummary(sale) },
    { header: "Amount", accessor: (sale) => sale.grandTotal },
  ];

  const BREAKDOWN_COLUMNS: XlsxColumn<{ itemType: ItemType; amount: number }>[] = [
    { header: "Item Type", accessor: (row) => ITEM_TYPE_LABELS[row.itemType] },
    { header: "Amount", accessor: (row) => row.amount },
  ];

  function handleDownload() {
    const sheets = [toSheetData("Sales", SALES_COLUMNS, data.sales)];
    if (breakdown.length > 0) {
      sheets.push(toSheetData("Revenue by Type", BREAKDOWN_COLUMNS, breakdown));
    }
    downloadXlsxWorkbook(`twinspark-sales-report-${todayForFilename()}`, sheets);
  }

  return (
    <div className="space-y-6">
      <BackToReports />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-neutral-900">Sales Report</h1>
          <p className="mt-1 text-sm text-neutral-500">What&apos;s actually selling.</p>
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
          <DownloadXlsxButton onClick={handleDownload} disabled={data.sales.length === 0} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard icon={IndianRupee} iconClassName="bg-success-bg text-success" label={`Sales Amount (${rangeLabel})`} value={formatINR(data.stats.totalSalesAmount)} />
        <StatCard icon={Receipt} iconClassName="bg-info-bg text-info" label={`Total Sales (${rangeLabel})`} value={data.stats.saleCount.toLocaleString("en-IN")} />
      </div>

      {breakdown.length > 0 && (
        <div className="rounded-[14px] border border-neutral-200 bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-neutral-900">Revenue by Item Type</p>
          <div className="flex flex-wrap gap-3">
            {breakdown.map((row) => (
              <div key={row.itemType} className="rounded-[10px] border border-neutral-100 bg-neutral-50 px-3 py-2">
                <p className="text-xs text-neutral-500">{ITEM_TYPE_LABELS[row.itemType]}</p>
                <p className="text-sm font-semibold text-neutral-900">{formatINR(row.amount)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <div role="table" aria-label="Sales Report" aria-busy={isLoading} className="min-w-[900px]">
          <div role="row" className={cn(ROW_GRID_CLASS, "px-4 py-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase")}>
            <span>Date</span>
            <span>Customer</span>
            <span>Invoice #</span>
            <span>Items</span>
            <span className="text-right">Amount</span>
          </div>

          <div className={cn("flex flex-col gap-2", isLoading && "opacity-60 transition-opacity")}>
            {data.sales.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <Receipt className="size-10 text-neutral-300" />
                <p className="text-sm text-neutral-500">No sales in this period.</p>
              </div>
            )}

            {data.sales.map((sale) => (
              <div key={sale.id} role="row" className={cn(ROW_GRID_CLASS, "items-center rounded-[10px] border border-neutral-200 bg-white px-4 py-3 shadow-sm")}>
                <div role="cell" aria-label="Date" className="min-w-0 text-sm text-neutral-700">
                  {formatDate(sale.saleDate)}
                </div>
                <div role="cell" aria-label="Customer" className="min-w-0">
                  <div className="truncate font-semibold text-neutral-900">{sale.customerName}</div>
                  <div className="truncate font-mono text-[11px] text-neutral-500">{sale.customerMobile}</div>
                </div>
                <div role="cell" aria-label="Invoice number" className="min-w-0 truncate font-mono text-sm text-neutral-700">
                  {sale.invoiceNumber}
                </div>
                <div role="cell" aria-label="Items" className="min-w-0 truncate text-sm text-neutral-700">
                  {itemsSummary(sale)}
                </div>
                <div role="cell" aria-label="Amount" className="min-w-0 text-right text-sm font-semibold text-neutral-900">
                  {formatINR(sale.grandTotal)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {data.total > data.sales.length && (
        <p className="text-center text-xs text-neutral-400">
          Showing the first {data.sales.length.toLocaleString("en-IN")} of {data.total.toLocaleString("en-IN")} sales.
        </p>
      )}
    </div>
  );
}
