"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, PhoneCall } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FollowUpCandidateRow, FollowUpReason } from "@/services/reports";
import { downloadXlsx, todayForFilename, type XlsxColumn } from "@/lib/xlsx-export";

import { fetchFollowUpCandidatesAction } from "@/app/(app)/reports/actions";

import { BackToReports } from "./back-to-reports";
import { DownloadXlsxButton } from "./download-xlsx-button";

const REASON_LABELS: Record<FollowUpReason, string> = {
  SALE: "Tyre purchase",
  SERVICE: "Service",
  BOTH: "Tyre + Service",
};

const REASON_VARIANTS: Record<FollowUpReason, "info" | "warning" | "danger"> = {
  SALE: "info",
  SERVICE: "warning",
  BOTH: "danger",
};

// Customer | Reason | Last Bought | Last Sale | Last Service | Actions
const ROW_GRID_CLASS = "grid grid-cols-[minmax(160px,220px)_150px_minmax(160px,1fr)_130px_130px_90px] gap-3";

export function CustomerFollowUpReportClient({
  initialCandidates,
  initialMonthsSinceSale,
  initialMonthsSinceService,
}: {
  initialCandidates: FollowUpCandidateRow[];
  initialMonthsSinceSale: number;
  initialMonthsSinceService: number;
}) {
  const [monthsSinceSale, setMonthsSinceSale] = useState(String(initialMonthsSinceSale));
  const [monthsSinceService, setMonthsSinceService] = useState(String(initialMonthsSinceService));
  const [candidates, setCandidates] = useState(initialCandidates);
  const [isLoading, setIsLoading] = useState(false);

  async function handleApply() {
    const sale = Number(monthsSinceSale);
    const service = Number(monthsSinceService);
    if (!Number.isFinite(sale) || sale <= 0 || !Number.isFinite(service) || service <= 0) {
      toast.error("Enter a positive number of months for both thresholds.");
      return;
    }

    setIsLoading(true);
    const result = await fetchFollowUpCandidatesAction({ monthsSinceSale: sale, monthsSinceService: service });
    setIsLoading(false);

    if (result.success) {
      setCandidates(result.data);
    } else {
      toast.error(result.error);
    }
  }

  const FOLLOWUP_COLUMNS: XlsxColumn<FollowUpCandidateRow>[] = [
    { header: "Customer", accessor: (c) => c.customerName },
    { header: "Mobile", accessor: (c) => c.customerMobile },
    { header: "Reason", accessor: (c) => REASON_LABELS[c.reason] },
    { header: "Last Bought", accessor: (c) => c.lastSaleItemSummary },
    { header: "Last Sale Date", accessor: (c) => (c.lastSaleDate ? formatDate(c.lastSaleDate) : null) },
    { header: "Last Service Date", accessor: (c) => (c.lastServiceDate ? formatDate(c.lastServiceDate) : null) },
  ];

  function handleDownload() {
    downloadXlsx(`twinspark-customer-followup-report-${todayForFilename()}`, "Follow-Up", FOLLOWUP_COLUMNS, candidates);
  }

  return (
    <div className="space-y-6">
      <BackToReports />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-neutral-900">Customer Follow-Up</h1>
          <p className="mt-1 text-sm text-neutral-500">Customers overdue for a tyre check or service — your call list.</p>
        </div>
        <DownloadXlsxButton onClick={handleDownload} disabled={candidates.length === 0} />
      </div>

      <div className="flex flex-col gap-3 rounded-[14px] border border-neutral-200 bg-white p-4 shadow-sm sm:flex-row sm:items-end sm:flex-wrap">
        <div className="space-y-1.5">
          <Label htmlFor="months-since-sale" className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
            Months since last sale
          </Label>
          <Input
            id="months-since-sale"
            type="number"
            min={1}
            className="h-9 w-[140px] rounded-[10px] text-sm"
            value={monthsSinceSale}
            onChange={(e) => setMonthsSinceSale(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="months-since-service" className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
            Months since last service
          </Label>
          <Input
            id="months-since-service"
            type="number"
            min={1}
            className="h-9 w-[140px] rounded-[10px] text-sm"
            value={monthsSinceService}
            onChange={(e) => setMonthsSinceService(e.target.value)}
          />
        </div>
        <Button size="sm" className="rounded-[10px]" disabled={isLoading} onClick={handleApply}>
          Apply
        </Button>
      </div>

      <div className="overflow-x-auto">
        <div role="table" aria-label="Customer Follow-Up" aria-busy={isLoading} className="min-w-[900px]">
          <div role="row" className={cn(ROW_GRID_CLASS, "px-4 py-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase")}>
            <span>Customer</span>
            <span>Reason</span>
            <span>Last Bought</span>
            <span>Last Sale</span>
            <span>Last Service</span>
            <span className="text-right">Actions</span>
          </div>

          <div className={cn("flex flex-col gap-2", isLoading && "opacity-60 transition-opacity")}>
            {candidates.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <PhoneCall className="size-10 text-neutral-300" />
                <p className="text-sm font-medium text-neutral-700">Nobody&apos;s overdue right now</p>
                <p className="text-sm text-neutral-500">Every customer has bought or visited within these thresholds.</p>
              </div>
            )}

            {candidates.map((candidate) => (
              <div key={candidate.customerId} role="row" className={cn(ROW_GRID_CLASS, "items-center rounded-[10px] border border-neutral-200 bg-white px-4 py-3 shadow-sm")}>
                <div role="cell" aria-label="Customer" className="min-w-0">
                  <div className="truncate font-semibold text-neutral-900">{candidate.customerName}</div>
                  <div className="truncate font-mono text-[11px] text-neutral-500">{candidate.customerMobile}</div>
                </div>
                <div role="cell" aria-label="Reason" className="min-w-0">
                  <Badge variant={REASON_VARIANTS[candidate.reason]}>{REASON_LABELS[candidate.reason]}</Badge>
                </div>
                <div role="cell" aria-label="Last bought" className="min-w-0 truncate text-sm text-neutral-700">
                  {candidate.lastSaleItemSummary ?? "—"}
                </div>
                <div role="cell" aria-label="Last sale" className="min-w-0 text-sm text-neutral-700">
                  {candidate.lastSaleDate ? formatDate(candidate.lastSaleDate) : "—"}
                </div>
                <div role="cell" aria-label="Last service" className="min-w-0 text-sm text-neutral-700">
                  {candidate.lastServiceDate ? formatDate(candidate.lastServiceDate) : "—"}
                </div>
                <div role="cell" aria-label="Actions" className="flex justify-end gap-1">
                  <Button asChild variant="ghost" size="icon" aria-label="View customer" title="View" className="size-9 rounded-[10px] text-neutral-500 hover:text-neutral-900">
                    <Link href={`/customers/${candidate.customerId}`}>
                      <Eye className="size-4" />
                    </Link>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
