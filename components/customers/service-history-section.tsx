"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Receipt, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatDate, formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ServiceJobRow } from "@/services/service";
import { JOB_STATUS_LABELS, ServiceJobStatusBadge } from "@/components/service/status-badge";

import { EmptyRow, HISTORY_PAGE_SIZE, SectionHeading, SectionSearch, ShowMoreButton, TableHeaderRow } from "./detail-section";

function servicesSummary(job: ServiceJobRow): string {
  if (job.lines.length === 0) return "—";
  const first = job.lines[0];
  const extra = job.lines.length - 1;
  return extra > 0 ? `${first.description} +${extra} more` : first.description;
}

function matchesSearch(job: ServiceJobRow, term: string, showVehicle: boolean): boolean {
  const haystack = [
    job.jobNumber,
    showVehicle ? job.vehicleNumber : "",
    showVehicle ? job.vehicleModel : "",
    JOB_STATUS_LABELS[job.status],
    servicesSummary(job),
    job.lines.map((l) => l.description).join(" "),
    formatDate(job.createdAt),
    String(job.grandTotal),
    formatINR(job.grandTotal),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(term);
}

/**
 * Shared between Customer Detail (a customer's jobs across all vehicles)
 * and Vehicle Detail (one vehicle's jobs) — same row shape either way, only
 * the query feeding it differs (doc/customer-vehicle-scope.md §2b/§2d).
 * Admin-only in both places since Service data is never shown to a Sales
 * Person (see getCustomerVehicleVisibility).
 *
 * Full-width table (2026-07-31 revision, replacing the earlier boxed
 * summary list) with its own search box — matches by job #, vehicle,
 * status, service names, date, or amount — and Date leads as the first
 * column.
 */
export function ServiceHistorySection({ serviceJobs, showVehicle = true }: { serviceJobs: ServiceJobRow[]; showVehicle?: boolean }) {
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(HISTORY_PAGE_SIZE);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return serviceJobs;
    return serviceJobs.filter((job) => matchesSearch(job, term, showVehicle));
  }, [serviceJobs, search, showVehicle]);

  const visible = filtered.slice(0, visibleCount);
  const hasActiveSearch = search.trim() !== "";

  function handleSearchChange(value: string) {
    setSearch(value);
    setVisibleCount(HISTORY_PAGE_SIZE);
  }

  // Date | Job # | [Vehicle] | Status | Services | Amount | Actions
  const gridClass = showVehicle
    ? "grid grid-cols-[110px_120px_140px_150px_minmax(200px,1fr)_120px_70px]"
    : "grid grid-cols-[110px_120px_150px_minmax(200px,1fr)_120px_70px]";

  return (
    <div className="space-y-3">
      <SectionHeading title="Service History" icon={Wrench} count={serviceJobs.length} />

      {serviceJobs.length === 0 ? (
        <EmptyRow icon={Wrench} text="No service jobs recorded yet." />
      ) : (
        <>
          <SectionSearch placeholder="Search by job #, vehicle, status, or service name..." value={search} onChange={handleSearchChange} />

          <div className="overflow-x-auto">
            <div role="table" aria-label="Service History" className="min-w-[900px]">
              <TableHeaderRow
                gridClass={gridClass}
                columns={showVehicle ? ["Date", "Job #", "Vehicle", "Status", "Services", "Amount", "Actions"] : ["Date", "Job #", "Status", "Services", "Amount", "Actions"]}
              />

              <div className="flex flex-col gap-2">
                {visible.length === 0 && <EmptyRow icon={Wrench} text="No service jobs match the current search." />}

                {visible.map((job) => (
                  <div key={job.id} role="row" className={cn(gridClass, "items-center gap-3 rounded-[10px] border border-neutral-200 bg-white px-4 py-3 shadow-sm transition-colors hover:bg-neutral-50")}>
                    <div role="cell" aria-label="Date" className="min-w-0 text-sm text-neutral-700">
                      {formatDate(job.createdAt)}
                    </div>

                    <div role="cell" aria-label="Job number" className="min-w-0 truncate font-mono text-sm text-neutral-700">
                      {job.jobNumber}
                    </div>

                    {showVehicle && (
                      <div role="cell" aria-label="Vehicle" className="min-w-0">
                        <div className="truncate font-mono text-sm text-neutral-900">{job.vehicleNumber}</div>
                        <div className="truncate text-[11px] text-neutral-500">{job.vehicleModel}</div>
                      </div>
                    )}

                    <div role="cell" aria-label="Status" className="min-w-0">
                      <ServiceJobStatusBadge status={job.status} />
                    </div>

                    <div role="cell" aria-label="Services" className="min-w-0 truncate text-sm text-neutral-700">
                      {servicesSummary(job)}
                    </div>

                    <div role="cell" aria-label="Amount" className="min-w-0 text-sm font-semibold text-neutral-900">
                      {formatINR(job.grandTotal)}
                    </div>

                    <div role="cell" aria-label="Actions" className="flex justify-end gap-1">
                      <Button
                        asChild
                        variant="ghost"
                        size="icon"
                        aria-label={job.status === "COMPLETED" ? "View invoice" : "Open job"}
                        title={job.status === "COMPLETED" ? "View invoice" : "Open job"}
                        className="size-9 rounded-[10px] text-neutral-500 hover:text-neutral-900"
                      >
                        <Link href={job.status === "COMPLETED" ? `/service/${job.id}/invoice` : `/service/${job.id}`}>
                          {job.status === "COMPLETED" ? <Receipt className="size-4" /> : <Wrench className="size-4" />}
                        </Link>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {visibleCount < filtered.length && <ShowMoreButton remaining={filtered.length - visibleCount} onClick={() => setVisibleCount((c) => c + HISTORY_PAGE_SIZE)} />}
          {hasActiveSearch && (
            <p className="text-xs text-neutral-400">
              {filtered.length} of {serviceJobs.length} shown
            </p>
          )}
        </>
      )}
    </div>
  );
}
