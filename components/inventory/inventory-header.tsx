"use client";

import Link from "next/link";
import { Download, Loader2, ShoppingCart } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatINR } from "@/lib/format";
import type { StatusCounts } from "@/services/inventory";

/**
 * Replaces InventoryStatsCards, which was four large cards for four numbers
 * and had been commented out entirely. Same figures, one line
 * (doc/inventory-redesign-scope.md §3a) — the owner reads holding value and
 * problem count without spending a third of the viewport on them.
 *
 * New Purchase links out to Purchases; Inventory itself still creates nothing.
 */
export function InventoryHeader({
  counts,
  inventoryValueCost,
  onExport,
  isExporting,
}: {
  counts: StatusCounts;
  inventoryValueCost: number;
  onExport: () => void;
  isExporting: boolean;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-neutral-900">Inventory</h1>
        <p className="mt-0.5 text-sm text-neutral-500">
          {counts.all.toLocaleString("en-IN")} {counts.all === 1 ? "item" : "items"}
          {" · "}
          {formatINR(inventoryValueCost)} at cost
          {counts.needsAttention > 0 && (
            <>
              {" · "}
              <span className="font-medium text-danger">
                {counts.needsAttention.toLocaleString("en-IN")} need attention
              </span>
            </>
          )}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" variant="secondary" size="sm" className="rounded-[10px]" onClick={onExport} disabled={isExporting}>
          {isExporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          Export
        </Button>
        <Button asChild size="sm" className="rounded-[10px]">
          <Link href="/purchases?action=new">
            <ShoppingCart className="size-4" />
            New purchase
          </Link>
        </Button>
      </div>
    </div>
  );
}
