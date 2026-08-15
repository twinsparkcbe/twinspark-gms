import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";
import { buildBuckets, findBucketIndex, type TrendGranularity } from "@/services/dashboard/buckets";

export interface ProfitPoint {
  label: string;
  fullLabel: string;
  salesAmount: number;
  cogs: number;
  profit: number;
}

type EmbeddedBatch = { unit_price: number } | { unit_price: number }[] | null;

function firstBatch(batch: EmbeddedBatch): { unit_price: number } | null {
  if (!batch) return null;
  return Array.isArray(batch) ? (batch[0] ?? null) : batch;
}

/**
 * Profit trend for the Reports module (doc/reports-scope.md §8) —
 * `Sales Amount − Cost of Goods Sold`, the same correction already applied
 * to the Dashboard (not the PRD's literal "Sales Amount − Purchase
 * Amount," which reads a restock month as a loss). Reuses the exact same
 * FIFO batch-cost logic as `getCostOfGoodsSold`
 * (`services/dashboard/cogs.ts`) — every `stock_movements` row with
 * `reason='SALE'` already carries the exact purchase batch it was drawn
 * from — just bucketed by `created_at` instead of summed over one range,
 * and bucketed the same way Dashboard's chart already buckets (reusing
 * `buildBuckets`/`findBucketIndex`).
 *
 * Deliberately excludes `reason='SERVICE_USAGE'` (parts consumed on a
 * Service job) — Profit stays Sales-only here, matching the Dashboard's
 * and the PRD's Profit Report definition, neither of which factor in
 * Service revenue/cost. `profit` can go negative and is never floored at
 * zero — an honest number matters more than a "nice" one.
 */
export async function getProfitTrend(
  supabase: SupabaseClient<Database>,
  granularity: TrendGranularity,
  now: Date = new Date()
): Promise<ProfitPoint[]> {
  const buckets = buildBuckets(granularity, now);
  const rangeStart = buckets[0].start.toISOString();
  const rangeEnd = buckets[buckets.length - 1].end.toISOString();

  const [salesRes, cogsRes] = await Promise.all([
    // Voided sales are corrections, not revenue (0029) — excluded from every
    // figure that adds up to money.
    // COGS below needs no equivalent filter: voiding writes a reversing
    // stock_movement, so the two SALE rows cancel out on their own.
    supabase
      .from("sales")
      .select("grand_total, sale_date")
      .is("voided_at", null)
      .gte("sale_date", rangeStart)
      .lt("sale_date", rangeEnd),
    supabase
      .from("stock_movements")
      .select("delta, created_at, purchase_entries!inner(unit_price)")
      .eq("reason", "SALE")
      .gte("created_at", rangeStart)
      .lt("created_at", rangeEnd),
  ]);

  if (salesRes.error) throw new Error(salesRes.error.message);
  if (cogsRes.error) throw new Error(cogsRes.error.message);

  const salesTotals = new Array(buckets.length).fill(0) as number[];
  const cogsTotals = new Array(buckets.length).fill(0) as number[];

  for (const row of (salesRes.data ?? []) as { grand_total: number; sale_date: string }[]) {
    const idx = findBucketIndex(buckets, row.sale_date);
    if (idx >= 0) salesTotals[idx] += Number(row.grand_total);
  }

  const cogsRows = (cogsRes.data ?? []) as unknown as { delta: number; created_at: string; purchase_entries: EmbeddedBatch }[];
  for (const row of cogsRows) {
    const idx = findBucketIndex(buckets, row.created_at);
    if (idx < 0) continue;
    const batch = firstBatch(row.purchase_entries);
    if (!batch) continue;
    // delta is negative for a SALE consumption — flip sign for a positive cost.
    cogsTotals[idx] += -row.delta * Number(batch.unit_price);
  }

  return buckets.map((b, i) => ({
    label: b.label,
    fullLabel: b.fullLabel,
    salesAmount: salesTotals[i],
    cogs: cogsTotals[i],
    profit: salesTotals[i] - cogsTotals[i],
  }));
}
