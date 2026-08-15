"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";
import type { InventoryItemRow } from "@/services/inventory";

/**
 * Answers "what do I need to buy today?" without a click
 * (doc/inventory-redesign-scope.md §3c).
 *
 * Fed by listReorderItems, which deliberately ignores the page's filters — a
 * search term typed to look something up must not make this strip appear to
 * empty out. Each card deep-links into a new Purchase for that item, so the
 * owner goes straight from "I'm out" to "restock it".
 *
 * Renders nothing at all when the list is empty: no heading, no empty-state
 * card. A healthy catalog should look calm.
 */
export function ReorderStrip({ items }: { items: InventoryItemRow[] }) {
  if (items.length === 0) return null;

  return (
    <section aria-label="Items needing reorder">
      <div className="mb-2 flex items-center gap-2">
        <AlertTriangle className="size-4 shrink-0 text-danger" aria-hidden="true" />
        <h2 className="text-sm font-bold text-neutral-900">Reorder now</h2>
        <span className="text-xs text-neutral-400">
          {items.length.toLocaleString("en-IN")} {items.length === 1 ? "item" : "items"}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const isOut = item.stockStatus === "out_of_stock";
          return (
            <Link
              key={item.id}
              href={`/purchases?action=new&itemId=${encodeURIComponent(item.id)}`}
              className={cn(
                "block rounded-[10px] p-3 transition-opacity hover:opacity-80",
                isOut ? "bg-danger-bg" : "bg-warning/10"
              )}
            >
              <p
                className={cn("truncate text-sm font-semibold", isOut ? "text-danger" : "text-warning")}
                title={item.productName}
              >
                {item.productName}
              </p>
              <p className="mt-0.5 truncate text-xs text-neutral-600">
                {item.availableQuantity.toLocaleString("en-IN")} left · reorder at{" "}
                {item.lowStockThreshold.toLocaleString("en-IN")}
              </p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
