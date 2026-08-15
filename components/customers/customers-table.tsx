"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight, Eye, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RelativeTime } from "@/components/shared/relative-time";
import { cn } from "@/lib/utils";
import type { CustomerRow } from "@/services/sales";

// Name | Mobile Number | Address | Customer Since | Actions
const ROW_GRID_CLASS = "grid grid-cols-[minmax(160px,220px)_140px_minmax(200px,320px)_140px_100px] gap-3";

/** Page numbers with ellipsis: 1 … current-1, current, current+1 … last. */
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

export function CustomersTable({
  customers,
  total,
  page,
  pageSize,
  isLoading,
  hasActiveFilters,
  onPageChange,
}: {
  customers: CustomerRow[];
  total: number;
  page: number;
  pageSize: number;
  isLoading: boolean;
  hasActiveFilters: boolean;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);
  const pageNumbers = getPageNumbers(page, totalPages);

  const showSkeleton = isLoading && customers.length === 0;
  const showEmpty = !showSkeleton && customers.length === 0;

  return (
    <div>
      <div className="overflow-x-auto">
        <div role="table" aria-label="Customers" aria-busy={isLoading} className="min-w-[900px]">
          <div role="row" className={cn(ROW_GRID_CLASS, "px-4 py-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase")}>
            <span>Name</span>
            <span>Mobile Number</span>
            <span>Address</span>
            <span>Customer Since</span>
            <span className="text-right">Actions</span>
          </div>

          <div className={cn("flex flex-col gap-2", isLoading && customers.length > 0 && "opacity-60 transition-opacity")}>
            {showSkeleton &&
              Array.from({ length: 8 }).map((_, i) => (
                <div key={`skeleton-${i}`} className={cn(ROW_GRID_CLASS, "items-center rounded-[10px] border border-neutral-200 bg-white px-4 py-3 shadow-sm")}>
                  {Array.from({ length: 5 }).map((__, j) => (
                    <Skeleton key={j} className="h-5 w-full max-w-24" />
                  ))}
                </div>
              ))}

            {showEmpty && (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <Users className="size-10 text-neutral-300" />
                {hasActiveFilters ? (
                  <p className="text-sm text-neutral-500">No customers match the current search.</p>
                ) : (
                  <>
                    <p className="text-sm font-medium text-neutral-700">No customers yet</p>
                    <p className="text-sm text-neutral-500">Customers are added automatically from Sales and Service.</p>
                  </>
                )}
              </div>
            )}

            {!showSkeleton &&
              customers.map((customer) => (
                <div
                  key={customer.id}
                  role="row"
                  className={cn(ROW_GRID_CLASS, "items-center rounded-[10px] border border-neutral-200 bg-white px-4 py-3 shadow-sm transition-colors hover:bg-neutral-50")}
                >
                  <div role="cell" aria-label="Name" className="min-w-0">
                    <Link href={`/customers/${customer.id}`} className="truncate font-semibold text-primary hover:underline">
                      {customer.name}
                    </Link>
                  </div>

                  <div role="cell" aria-label="Mobile number" className="min-w-0 truncate font-mono text-sm text-neutral-700">
                    {customer.mobileNumber}
                  </div>

                  <div role="cell" aria-label="Address" className="min-w-0 truncate text-sm text-neutral-500">
                    {customer.address ?? "—"}
                  </div>

                  <div role="cell" aria-label="Customer since" className="min-w-0">
                    <RelativeTime iso={customer.createdAt} />
                  </div>

                  <div role="cell" aria-label="Actions" className="flex justify-end gap-1">
                    <Button asChild variant="ghost" size="icon" aria-label="View customer" title="View" className="size-9 rounded-[10px] text-neutral-500 hover:text-neutral-900">
                      <Link href={`/customers/${customer.id}`}>
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
            <Button variant="secondary" size="icon" aria-label="Previous page" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
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
                  variant={p === page ? "primary" : "secondary"}
                  size="icon"
                  className={cn(p === page && "bg-danger hover:bg-danger/90")}
                  onClick={() => onPageChange(p)}
                >
                  {p}
                </Button>
              )
            )}
            <Button variant="secondary" size="icon" aria-label="Next page" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
