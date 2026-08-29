import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

type EmbeddedBatch = { unit_price: number } | { unit_price: number }[] | null;

function firstBatch(batch: EmbeddedBatch): { unit_price: number } | null {
  if (!batch) return null;
  return Array.isArray(batch) ? (batch[0] ?? null) : batch;
}

/**
 * Exact FIFO cost of the inventory actually sold through the Sales module
 * *and* consumed by completed Service Jobs in the given range — this is the
 * real Profit subtrahend, not "how much stock was purchased in this period"
 * (the old, misleading calculation: buying a pile of stock in March that
 * mostly sells in April used to tank March's "profit" and inflate April's).
 *
 * Every `stock_movements` row with reason='SALE' or reason='SERVICE_USAGE'
 * is already linked to the exact purchase batch it was drawn from via
 * `purchase_entry_id` — set by `adjust_stock()`'s FIFO consumption loop
 * (0010_purchase_batch_fifo.sql). Summing quantity × that batch's own
 * `unit_price` gives the real, batch-accurate cost of what was sold/used, no
 * averaging or approximation.
 *
 * Scoped to reason IN ('SALE', 'SERVICE_USAGE', 'ONLINE_ORDER_DISPATCH') —
 * the three ways stock leaves for money. Online dispatches were added
 * (doc/online-orders-revenue-scope.md §3.3) at the same time as their
 * revenue: before that the tyres left the shelf with neither their sale
 * price nor their cost recorded anywhere. Revenue and cost must stay on the
 * same footing — widening one without the other would make Profit wrong in
 * a direction nobody would notice.
 *
 * SERVICE_USAGE was added alongside Dashboard Profit now folding in Service
 * Job revenue (doc/dashboard-redesign-scope.md addendum) — a service that
 * consumes parts but whose cost was never subtracted used to overstate
 * profit the moment Service revenue was added to the numerator.
 *
 * Like every other sales figure in this app, this counts gross activity —
 * not netted against later `sale_returns` (see getSalesStats/trend.ts for
 * the same convention).
 */
export async function getCostOfGoodsSold(
  supabase: SupabaseClient<Database>,
  range: { from: Date; to: Date }
): Promise<number> {
  const { data, error } = await supabase
    .from("stock_movements")
    .select("delta, purchase_entries!inner(unit_price)")
    .in("reason", ["SALE", "SERVICE_USAGE", "ONLINE_ORDER_DISPATCH"])
    .gte("created_at", range.from.toISOString())
    .lte("created_at", range.to.toISOString());

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as { delta: number; purchase_entries: EmbeddedBatch }[];

  return rows.reduce((sum, row) => {
    const batch = firstBatch(row.purchase_entries);
    if (!batch) return sum;
    // delta is negative for a consumption — flip sign for a positive cost.
    return sum + -row.delta * Number(batch.unit_price);
  }, 0);
}
