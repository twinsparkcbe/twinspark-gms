"use client";

import { useState } from "react";
import { Boxes } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RelativeTime } from "@/components/shared/relative-time";
import { formatDate, formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ITEM_TYPE_BADGE_CLASS, getItemTypeBadgeText } from "@/components/inventory/constants";
import type { AgeingStockRow } from "@/services/reports";
import { downloadXlsx, todayForFilename, type XlsxColumn } from "@/lib/xlsx-export";

import { fetchAgeingStockAction } from "@/app/(app)/reports/actions";

import { BackToReports } from "./back-to-reports";
import { DownloadXlsxButton } from "./download-xlsx-button";

// Item | Type | Brand | Oldest Batch | Remaining Qty | Cash Tied Up
const ROW_GRID_CLASS = "grid grid-cols-[minmax(180px,1fr)_140px_130px_170px_120px_130px] gap-3";

export function AgeingStockReportClient({
  initialRows,
  initialMonthsThreshold,
}: {
  initialRows: AgeingStockRow[];
  initialMonthsThreshold: number;
}) {
  const [monthsThreshold, setMonthsThreshold] = useState(String(initialMonthsThreshold));
  const [rows, setRows] = useState(initialRows);
  const [isLoading, setIsLoading] = useState(false);

  async function handleApply() {
    const months = Number(monthsThreshold);
    if (!Number.isFinite(months) || months <= 0) {
      toast.error("Enter a positive number of months.");
      return;
    }

    setIsLoading(true);
    const result = await fetchAgeingStockAction(months);
    setIsLoading(false);

    if (result.success) {
      setRows(result.data);
    } else {
      toast.error(result.error);
    }
  }

  const totalTiedUp = rows.reduce((sum, r) => sum + r.remainingQuantity * r.unitPrice, 0);

  const AGEING_COLUMNS: XlsxColumn<AgeingStockRow>[] = [
    { header: "Item", accessor: (row) => row.itemName },
    { header: "SKU", accessor: (row) => row.itemSkuCode },
    { header: "Type", accessor: (row) => getItemTypeBadgeText(row) },
    { header: "Brand", accessor: (row) => row.brandName },
    { header: "Oldest Batch", accessor: (row) => formatDate(row.oldestBatchDate) },
    { header: "Remaining Qty", accessor: (row) => row.remainingQuantity },
    { header: "Cash Tied Up", accessor: (row) => row.remainingQuantity * row.unitPrice },
  ];

  function handleDownload() {
    downloadXlsx(`twinspark-ageing-stock-report-${todayForFilename()}`, "Ageing Stock", AGEING_COLUMNS, rows);
  }

  return (
    <div className="space-y-6">
      <BackToReports />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-neutral-900">Ageing Stock</h1>
          <p className="mt-1 text-sm text-neutral-500">
            What&apos;s been sitting on the shelf too long &mdash; shelf time, not a printed expiry date.
          </p>
        </div>
        <DownloadXlsxButton onClick={handleDownload} disabled={rows.length === 0} />
      </div>

      <div className="flex flex-col gap-3 rounded-[14px] border border-neutral-200 bg-white p-4 shadow-sm sm:flex-row sm:items-end sm:flex-wrap sm:justify-between">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="ageing-months" className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
              Months since oldest batch
            </Label>
            <Input
              id="ageing-months"
              type="number"
              min={1}
              className="h-9 w-[140px] rounded-[10px] text-sm"
              value={monthsThreshold}
              onChange={(e) => setMonthsThreshold(e.target.value)}
            />
          </div>
          <Button size="sm" className="rounded-[10px]" disabled={isLoading} onClick={handleApply}>
            Apply
          </Button>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Cash tied up</p>
          <p className="text-lg font-bold text-neutral-900">{formatINR(totalTiedUp)}</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div role="table" aria-label="Ageing Stock" aria-busy={isLoading} className="min-w-[900px]">
          <div role="row" className={cn(ROW_GRID_CLASS, "px-4 py-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase")}>
            <span>Item</span>
            <span>Type</span>
            <span>Brand</span>
            <span>Oldest Batch</span>
            <span>Remaining Qty</span>
            <span className="text-right">Cash Tied Up</span>
          </div>

          <div className={cn("flex flex-col gap-2", isLoading && "opacity-60 transition-opacity")}>
            {rows.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <Boxes className="size-10 text-neutral-300" />
                <p className="text-sm font-medium text-neutral-700">Nothing&apos;s ageing right now</p>
                <p className="text-sm text-neutral-500">No unsold batch is older than this threshold.</p>
              </div>
            )}

            {rows.map((row) => (
              <div key={row.inventoryItemId} role="row" className={cn(ROW_GRID_CLASS, "items-center rounded-[10px] border border-neutral-200 bg-white px-4 py-3 shadow-sm")}>
                <div role="cell" aria-label="Item" className="min-w-0 truncate font-semibold text-neutral-900">
                  {row.itemName}
                </div>
                <div role="cell" aria-label="Type" className="min-w-0">
                  <Badge className={cn("border-none", ITEM_TYPE_BADGE_CLASS[row.itemType])}>{getItemTypeBadgeText(row)}</Badge>
                </div>
                <div role="cell" aria-label="Brand" className="min-w-0 truncate text-sm text-neutral-700">
                  {row.brandName ?? "—"}
                </div>
                <div role="cell" aria-label="Oldest batch" className="min-w-0">
                  <div className="text-sm text-neutral-700">{formatDate(row.oldestBatchDate)}</div>
                  <div className="text-[11px] text-neutral-400">
                    <RelativeTime iso={row.oldestBatchDate} />
                  </div>
                </div>
                <div role="cell" aria-label="Remaining quantity" className="min-w-0 text-sm text-neutral-700">
                  {row.remainingQuantity.toLocaleString("en-IN")}
                </div>
                <div role="cell" aria-label="Cash tied up" className="min-w-0 text-right text-sm font-semibold text-neutral-900">
                  {formatINR(row.remainingQuantity * row.unitPrice)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
