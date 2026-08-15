"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ClipboardList, PlusCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useGlobalLoader } from "@/components/shared/global-loader";
import type { UserRole } from "@/lib/auth/permissions";
import { canManageServiceCatalog, canSetServicePaymentStatus } from "@/lib/auth/permissions";
import type { ServiceJobRow, ServiceStats } from "@/services/service";
import type { MechanicOption } from "@/services/users";
import type { ServiceJobStatus } from "@/types/database.types";

import { fetchServiceJobsAction, fetchServiceStatsAction } from "@/app/(app)/service/actions";

import { buildDefaultServiceFilters, type ServiceFilterState } from "./service-filter-state";
import { ServiceFilters } from "./service-filters";
import { ServiceJobsTable } from "./service-jobs-table";
import { ServiceStatsCards } from "./service-stats";

export type { ServiceFilterState } from "./service-filter-state";

const PAGE_SIZE = 10;

export function ServicePageClient({
  initialJobs,
  initialTotal,
  initialStats,
  mechanics,
  currentUser,
}: {
  initialJobs: ServiceJobRow[];
  initialTotal: number;
  initialStats: ServiceStats;
  mechanics: MechanicOption[];
  currentUser: { id: string; role: UserRole };
}) {
  const defaultFilters = buildDefaultServiceFilters(currentUser);
  const [filters, setFilters] = useState<ServiceFilterState>(defaultFilters);
  const [page, setPage] = useState(1);
  const [jobs, setJobs] = useState(initialJobs);
  const [total, setTotal] = useState(initialTotal);
  const [isLoading, setIsLoading] = useState(false);
  const [stats, setStats] = useState(initialStats);

  const isTextChangeRef = useRef(false);
  const hasMountedRef = useRef(false);
  const { runWithLoader } = useGlobalLoader();

  const refetch = useCallback(async () => {
    setIsLoading(true);
    const result = await runWithLoader(() =>
      fetchServiceJobsAction({
        search: filters.search || undefined,
        status: (filters.status || undefined) as ServiceJobStatus | undefined,
        assignedMechanicId: filters.assignedMechanicId || undefined,
        dateFrom: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
        dateTo: filters.dateTo ? new Date(`${filters.dateTo}T23:59:59.999`) : undefined,
        page,
        pageSize: PAGE_SIZE,
      })
    );
    setIsLoading(false);

    if (result.success) {
      setJobs(result.data.jobs);
      setTotal(result.data.total);
    } else {
      toast.error(result.error);
    }
  }, [filters, page, runWithLoader]);

  const refreshStats = useCallback(async () => {
    const result = await runWithLoader(() =>
      fetchServiceStatsAction({
        from: filters.dateFrom || undefined,
        to: filters.dateTo ? `${filters.dateTo}T23:59:59.999` : undefined,
      })
    );
    if (result.success) setStats(result.data);
  }, [filters.dateFrom, filters.dateTo, runWithLoader]);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    const delay = isTextChangeRef.current ? 300 : 0;
    const handle = setTimeout(() => {
      refetch();
      refreshStats();
    }, delay);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, page]);

  function handleFilterChange(next: Partial<ServiceFilterState>) {
    isTextChangeRef.current = Object.prototype.hasOwnProperty.call(next, "search");
    setFilters((prev) => ({ ...prev, ...next }));
    setPage(1);
  }

  function handleResetFilters() {
    isTextChangeRef.current = false;
    setFilters(buildDefaultServiceFilters(currentUser));
    setPage(1);
  }

  function handlePageChange(nextPage: number) {
    isTextChangeRef.current = false;
    setPage(nextPage);
  }

  /** Inline row actions (rework plan Change 3) patch just the row they
   * changed. Stats are refreshed too, since completing or settling a job
   * moves the figures in the cards above. */
  function handleJobUpdated(updated: ServiceJobRow) {
    setJobs((prev) => prev.map((job) => (job.id === updated.id ? updated : job)));
    refreshStats();
  }

  // "My jobs" is a Mechanic's baseline, not something they filtered down to —
  // counting it here would show the filtered-stats caption on a fresh load.
  const hasActiveFilters =
    filters.search !== "" ||
    filters.status !== "" ||
    filters.dateFrom !== "" ||
    filters.dateTo !== "" ||
    filters.assignedMechanicId !== defaultFilters.assignedMechanicId;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-neutral-900 sm:text-3xl">Service</h1>
          <p className="mt-1 text-sm text-neutral-500">Service jobs, job cards, and service invoices.</p>
        </div>
        {/* One primary action, matching Sales' "New Sale" — the two-step
            "Accept Vehicle" + "or enter full details now" split asked the
            owner to pick an intake style before they'd entered anything, and
            full entry covers both cases. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {/* Kept as an in-context shortcut even though Services & Prices is
              now its own sidebar item — the sidebar solves discovery, this
              still saves a trip for someone already looking at jobs. */}
          {canManageServiceCatalog(currentUser.role) && (
            <Button asChild variant="secondary" className="rounded-[10px]">
              <Link href="/service/catalog">
                <ClipboardList className="size-4" />
                Services &amp; Prices
              </Link>
            </Button>
          )}
          <Button asChild className="rounded-[10px] bg-primary hover:bg-primary/90">
            <Link href="/service/new">
              <PlusCircle className="size-4" />
              New Service
            </Link>
          </Button>
        </div>
      </div>

      {/* <ServiceStatsCards stats={stats} isFiltered={hasActiveFilters} /> */}

      <ServiceFilters filters={filters} onChange={handleFilterChange} onReset={handleResetFilters} mechanics={mechanics} />

      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-neutral-900">
          Service Jobs <span className="font-normal text-neutral-400">({total.toLocaleString("en-IN")})</span>
        </p>
      </div>

      <ServiceJobsTable
        jobs={jobs}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        isLoading={isLoading}
        hasActiveFilters={hasActiveFilters}
        isAdmin={currentUser.role === "admin"}
        canRecordPayment={canSetServicePaymentStatus(currentUser.role)}
        onPageChange={handlePageChange}
        onJobUpdated={handleJobUpdated}
      />
    </div>
  );
}
