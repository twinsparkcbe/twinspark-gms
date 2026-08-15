"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Page numbers with ellipsis: 1 … current-1, current, current+1 … last. */
export function getPageNumbers(current: number, total: number): (number | "ellipsis")[] {
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
 * Shared list pagination. Every list screen had its own near-identical copy of
 * this; the differences were accidental rather than intentional.
 *
 * Below `sm` the numbered buttons collapse to a plain "Page 2 of 11" readout.
 * Seven number buttons plus prev/next is ~330px of controls, which doesn't fit
 * a phone without wrapping into a second row of tap targets.
 */
export function ListPagination({
  page,
  pageSize,
  total,
  isLoading = false,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  isLoading?: boolean;
  onPageChange: (page: number) => void;
}) {
  if (total === 0) return null;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);
  const pageNumbers = getPageNumbers(page, totalPages);

  return (
    <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
      <p className="text-sm text-neutral-500">
        Showing <span className="font-medium text-neutral-700">{rangeStart}</span>–
        <span className="font-medium text-neutral-700">{rangeEnd}</span> of{" "}
        <span className="font-medium text-neutral-700">{total.toLocaleString("en-IN")}</span>
      </p>

      <div className="flex items-center gap-1">
        <Button
          variant="secondary"
          size="icon"
          aria-label="Previous page"
          disabled={isLoading || page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="size-4" />
        </Button>

        <span className="px-2 text-sm text-neutral-600 sm:hidden">
          Page {page} of {totalPages}
        </span>

        <span className="hidden items-center gap-1 sm:flex">
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
                aria-label={`Page ${p}`}
                aria-current={p === page ? "page" : undefined}
                disabled={isLoading}
                onClick={() => onPageChange(p)}
              >
                {p}
              </Button>
            )
          )}
        </span>

        <Button
          variant="secondary"
          size="icon"
          aria-label="Next page"
          disabled={isLoading || page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
