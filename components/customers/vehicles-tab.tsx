"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Bike, ChevronLeft, ChevronRight, Eye, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { VehicleWithOwnerRow } from "@/services/service";

// Vehicle Number | Model | Latest Odometer | Owner | Actions
const ROW_GRID_CLASS = "grid grid-cols-[160px_minmax(160px,220px)_150px_minmax(180px,260px)_100px] gap-3";
const PAGE_SIZE = 20;

function getPageNumbers(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, current - 1, current, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const result: (number | "ellipsis")[] = [];
  sorted.forEach((page, i) => {
    if (i > 0 && page - sorted[i - 1] > 1) result.push("ellipsis");
    result.push(page);
  });
  return result;
}

/**
 * Vehicles tab (doc/customer-vehicle-scope.md §2c) — plate-first lookup for
 * "show all past services for KA-01-XXXX" without going through the owning
 * customer first. All vehicles are fetched once by the server page (same
 * "fetch once, filter client-side" pattern as the Sales/Service pickers),
 * so search and pagination here are both purely client-side, no round trip.
 */
export function VehiclesTab({ vehicles }: { vehicles: VehicleWithOwnerRow[] }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return vehicles;
    return vehicles.filter(
      (v) =>
        v.vehicleNumber.toLowerCase().includes(term) ||
        v.vehicleModel.toLowerCase().includes(term) ||
        v.customerName.toLowerCase().includes(term) ||
        v.customerMobile.includes(term)
    );
  }, [vehicles, search]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const rangeStart = total === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, total);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const pageNumbers = getPageNumbers(currentPage, totalPages);
  const hasActiveSearch = search.trim() !== "";
  const showEmpty = pageItems.length === 0;

  function handleSearchChange(value: string) {
    setSearch(value);
    setPage(1);
  }

  return (
    <div className="space-y-3">
      <div className="relative min-w-0 sm:max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-neutral-400" />
        <Input
          placeholder="Search by vehicle number, model, owner, or mobile..."
          className="h-9 rounded-[10px] pl-9 text-sm"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
        />
      </div>

      <div className="overflow-x-auto">
        <div role="table" aria-label="Vehicles" className="min-w-[900px]">
          <div role="row" className={cn(ROW_GRID_CLASS, "px-4 py-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase")}>
            <span>Vehicle Number</span>
            <span>Model</span>
            <span>Latest Odometer</span>
            <span>Owner</span>
            <span className="text-right">Actions</span>
          </div>

          <div className="flex flex-col gap-2">
            {showEmpty && (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <Bike className="size-10 text-neutral-300" />
                {hasActiveSearch ? (
                  <p className="text-sm text-neutral-500">No vehicles match the current search.</p>
                ) : (
                  <>
                    <p className="text-sm font-medium text-neutral-700">No vehicles yet</p>
                    <p className="text-sm text-neutral-500">Vehicles are added automatically from Service Jobs.</p>
                  </>
                )}
              </div>
            )}

            {pageItems.map((vehicle) => (
              <div
                key={vehicle.id}
                role="row"
                className={cn(ROW_GRID_CLASS, "items-center rounded-[10px] border border-neutral-200 bg-white px-4 py-3 shadow-sm transition-colors hover:bg-neutral-50")}
              >
                <div role="cell" aria-label="Vehicle number" className="min-w-0">
                  <Link href={`/customers/vehicles/${vehicle.id}`} className="truncate font-mono text-sm font-semibold text-primary hover:underline">
                    {vehicle.vehicleNumber}
                  </Link>
                </div>

                <div role="cell" aria-label="Model" className="min-w-0 truncate text-sm text-neutral-700">
                  {vehicle.vehicleModel}
                </div>

                <div role="cell" aria-label="Latest odometer" className="min-w-0 text-sm text-neutral-700">
                  {vehicle.latestOdometerReading !== null ? `${vehicle.latestOdometerReading.toLocaleString("en-IN")} km` : "—"}
                </div>

                <div role="cell" aria-label="Owner" className="min-w-0">
                  <div className="truncate text-sm text-neutral-900">{vehicle.customerName}</div>
                  <div className="mt-0.5 truncate font-mono text-[11px] text-neutral-500">{vehicle.customerMobile}</div>
                </div>

                <div role="cell" aria-label="Actions" className="flex justify-end gap-1">
                  <Button asChild variant="ghost" size="icon" aria-label="View vehicle" title="View" className="size-9 rounded-[10px] text-neutral-500 hover:text-neutral-900">
                    <Link href={`/customers/vehicles/${vehicle.id}`}>
                      <Eye className="size-4" />
                    </Link>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {total > 0 && (
        <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
          <p className="text-sm text-neutral-500">
            Showing <span className="font-medium text-neutral-700">{rangeStart}</span>–
            <span className="font-medium text-neutral-700">{rangeEnd}</span> of{" "}
            <span className="font-medium text-neutral-700">{total.toLocaleString("en-IN")}</span>
          </p>
          <div className="flex items-center gap-1">
            <Button variant="secondary" size="icon" aria-label="Previous page" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
              <ChevronLeft className="size-4" />
            </Button>
            {pageNumbers.map((p, i) =>
              p === "ellipsis" ? (
                <span key={`ellipsis-${i}`} className="px-1 text-sm text-neutral-400">
                  …
                </span>
              ) : (
                <Button
                  key={p}
                  variant={p === currentPage ? "primary" : "secondary"}
                  size="icon"
                  className={cn(p === currentPage && "bg-danger hover:bg-danger/90")}
                  onClick={() => setPage(p)}
                >
                  {p}
                </Button>
              )
            )}
            <Button variant="secondary" size="icon" aria-label="Next page" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
