import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";
import { buildBuckets, findBucketIndex, type TrendGranularity } from "@/services/dashboard/buckets";

export interface RevenuePoint {
  label: string;
  fullLabel: string;
  salesAmount: number;
  serviceAmount: number;
  onlineAmount: number;
}

/**
 * Broader revenue trend for the Reports module (doc/reports-scope.md §7) —
 * deliberately not Dashboard's `getTrackTyreSalesTrend`, which only tracks
 * Track Tyre *quantity*, not revenue, and is scoped to one product. This
 * buckets Sales revenue and completed Service revenue, reusing the exact
 * same bucket boundaries (`buildBuckets`/`findBucketIndex`,
 * `services/dashboard/buckets.ts`) as Dashboard's chart so the two screens
 * read consistently.
 *
 * Online Order revenue is its own third series alongside Sales and Service
 * (doc/online-orders-revenue-scope.md §3.2), never folded into salesAmount —
 * "Sales" means the Sales module on every screen in this app, so that column
 * still reconciles against the Sales Report. Online orders are bucketed by
 * `dispatched_at`, the moment the stock leaves.
 */
export async function getRevenueTrend(
  supabase: SupabaseClient<Database>,
  granularity: TrendGranularity,
  now: Date = new Date()
): Promise<RevenuePoint[]> {
  const buckets = buildBuckets(granularity, now);
  const rangeStart = buckets[0].start.toISOString();
  const rangeEnd = buckets[buckets.length - 1].end.toISOString();

  const [salesRes, serviceRes, onlineRes] = await Promise.all([
    // Voided sales are corrections, not revenue (0029) — excluded from every
    // figure that adds up to money.
    supabase
      .from("sales")
      .select("grand_total, sale_date")
      .is("voided_at", null)
      .gte("sale_date", rangeStart)
      .lt("sale_date", rangeEnd),
    supabase
      .from("service_jobs")
      .select("grand_total, completed_at")
      .eq("status", "COMPLETED")
      .gte("completed_at", rangeStart)
      .lt("completed_at", rangeEnd),
    supabase
      .from("online_orders")
      .select("total_amount, dispatched_at")
      .eq("status", "DISPATCHED")
      .gte("dispatched_at", rangeStart)
      .lt("dispatched_at", rangeEnd),
  ]);

  if (salesRes.error) throw new Error(salesRes.error.message);
  if (serviceRes.error) throw new Error(serviceRes.error.message);
  if (onlineRes.error) throw new Error(onlineRes.error.message);

  const salesTotals = new Array(buckets.length).fill(0) as number[];
  const serviceTotals = new Array(buckets.length).fill(0) as number[];
  const onlineTotals = new Array(buckets.length).fill(0) as number[];

  for (const row of (salesRes.data ?? []) as { grand_total: number; sale_date: string }[]) {
    const idx = findBucketIndex(buckets, row.sale_date);
    if (idx >= 0) salesTotals[idx] += Number(row.grand_total);
  }

  for (const row of (serviceRes.data ?? []) as { grand_total: number; completed_at: string | null }[]) {
    if (!row.completed_at) continue;
    const idx = findBucketIndex(buckets, row.completed_at);
    if (idx >= 0) serviceTotals[idx] += Number(row.grand_total);
  }

  for (const row of (onlineRes.data ?? []) as { total_amount: number; dispatched_at: string | null }[]) {
    if (!row.dispatched_at) continue;
    const idx = findBucketIndex(buckets, row.dispatched_at);
    if (idx >= 0) onlineTotals[idx] += Number(row.total_amount);
  }

  return buckets.map((b, i) => ({
    label: b.label,
    fullLabel: b.fullLabel,
    salesAmount: salesTotals[i],
    serviceAmount: serviceTotals[i],
    onlineAmount: onlineTotals[i],
  }));
}
