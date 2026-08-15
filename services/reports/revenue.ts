import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";
import { buildBuckets, findBucketIndex, type TrendGranularity } from "@/services/dashboard/buckets";

export interface RevenuePoint {
  label: string;
  fullLabel: string;
  salesAmount: number;
  serviceAmount: number;
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
 * Online Order revenue is excluded — same scope note already agreed for
 * the Dashboard's Profit figure (doc/dashboard-scope.md addendum): revenue
 * and cost stay on the same footing, and broadening one without the other
 * would silently change what "revenue" means between screens.
 */
export async function getRevenueTrend(
  supabase: SupabaseClient<Database>,
  granularity: TrendGranularity,
  now: Date = new Date()
): Promise<RevenuePoint[]> {
  const buckets = buildBuckets(granularity, now);
  const rangeStart = buckets[0].start.toISOString();
  const rangeEnd = buckets[buckets.length - 1].end.toISOString();

  const [salesRes, serviceRes] = await Promise.all([
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
  ]);

  if (salesRes.error) throw new Error(salesRes.error.message);
  if (serviceRes.error) throw new Error(serviceRes.error.message);

  const salesTotals = new Array(buckets.length).fill(0) as number[];
  const serviceTotals = new Array(buckets.length).fill(0) as number[];

  for (const row of (salesRes.data ?? []) as { grand_total: number; sale_date: string }[]) {
    const idx = findBucketIndex(buckets, row.sale_date);
    if (idx >= 0) salesTotals[idx] += Number(row.grand_total);
  }

  for (const row of (serviceRes.data ?? []) as { grand_total: number; completed_at: string | null }[]) {
    if (!row.completed_at) continue;
    const idx = findBucketIndex(buckets, row.completed_at);
    if (idx >= 0) serviceTotals[idx] += Number(row.grand_total);
  }

  return buckets.map((b, i) => ({
    label: b.label,
    fullLabel: b.fullLabel,
    salesAmount: salesTotals[i],
    serviceAmount: serviceTotals[i],
  }));
}
