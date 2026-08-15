import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

import { buildBuckets, findBucketIndex, type TrendGranularity } from "./buckets";

export interface TrendPoint {
  /** Short axis label, e.g. "29 Jul" / "21 Jul" (week start) / "Jul 26". */
  label: string;
  /** Full label for the chart tooltip, e.g. "29 Jul 2026" / "21 Jul - 27 Jul 2026" / "July 2026". */
  fullLabel: string;
  unitsSold: number;
}

type EmbeddedSale = { sale_date: string } | { sale_date: string }[] | null;

function firstSale(sale: EmbeddedSale): { sale_date: string } | null {
  if (!sale) return null;
  return Array.isArray(sale) ? (sale[0] ?? null) : sale;
}

/**
 * Track Tyre units sold per period — combines the two channels stock
 * actually leaves through (confirmed decision, doc/dashboard-scope.md
 * addendum): in-store Sales (`sale_items` PRODUCT lines against the Front/
 * Back inventory rows) and Dispatched Online Orders (`quantity_front` +
 * `quantity_back`, counted at `dispatched_at` — stock only leaves on
 * Dispatch per rule §15, not at submission/verification/approval). Front and
 * Back are combined into one number per bucket (also confirmed). Like every
 * other sales figure in this app (`getSalesStats`), this counts gross
 * quantity at sale/dispatch time — not netted against later `sale_returns`.
 */
export async function getTrackTyreSalesTrend(
  supabase: SupabaseClient<Database>,
  granularity: TrendGranularity,
  now: Date = new Date()
): Promise<TrendPoint[]> {
  const buckets = buildBuckets(granularity, now);
  const rangeStart = buckets[0].start.toISOString();
  const rangeEnd = buckets[buckets.length - 1].end.toISOString();

  const [saleItemsRes, dispatchedOrdersRes] = await Promise.all([
    supabase
      .from("sale_items")
      .select("quantity, sales!inner(sale_date, voided_at), inventory_items!inner(product_name)")
      .eq("line_type", "PRODUCT")
      // Filtered through the !inner join on sales — a voided sale's units never
      // left the shelf, so they can't count toward the trend (0029).
      .is("sales.voided_at", null)
      .in("inventory_items.product_name", ["Track Tyre - Front", "Track Tyre - Back"])
      .gte("sales.sale_date", rangeStart)
      .lt("sales.sale_date", rangeEnd),
    supabase
      .from("online_orders")
      .select("quantity_front, quantity_back, dispatched_at")
      .eq("status", "DISPATCHED")
      .gte("dispatched_at", rangeStart)
      .lt("dispatched_at", rangeEnd),
  ]);

  if (saleItemsRes.error) throw new Error(saleItemsRes.error.message);
  if (dispatchedOrdersRes.error) throw new Error(dispatchedOrdersRes.error.message);

  const totals = new Array(buckets.length).fill(0) as number[];

  const saleRows = (saleItemsRes.data ?? []) as unknown as { quantity: number | null; sales: EmbeddedSale }[];
  for (const row of saleRows) {
    const sale = firstSale(row.sales);
    if (!sale) continue;
    const idx = findBucketIndex(buckets, sale.sale_date);
    if (idx >= 0) totals[idx] += row.quantity ?? 0;
  }

  const orderRows = (dispatchedOrdersRes.data ?? []) as {
    quantity_front: number;
    quantity_back: number;
    dispatched_at: string | null;
  }[];
  for (const row of orderRows) {
    if (!row.dispatched_at) continue;
    const idx = findBucketIndex(buckets, row.dispatched_at);
    if (idx >= 0) totals[idx] += (row.quantity_front ?? 0) + (row.quantity_back ?? 0);
  }

  return buckets.map((b, i) => ({ label: b.label, fullLabel: b.fullLabel, unitsSold: totals[i] }));
}
