import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

import { salePickerKey, type SaleUsageCounts } from "./picker";

/**
 * How often each item has actually sold (sales rework §4.A).
 *
 * Ranks the picker's search results and fills the quick-add chips. Unlike
 * Service — where a part is chosen because *this* bike needed it — a counter
 * sale really is the same handful of tyres all day, so habit is exactly the
 * right signal here.
 *
 * Counts rows rather than units: a chip should surface what gets sold
 * *often*, not what happens to move in bulk on one big invoice.
 *
 * Combo rows produce two kinds of `sale_items`: the COMBO line itself, and
 * the product rows the server expanded from it. Neither is tallied here —
 * combos are deliberately not offered in Sale Items (confirmed decision,
 * 2026-08-15; see services/sales/picker.ts), and expanded products
 * (`included_in_combo`) are skipped regardless — a tyre that only ever
 * moves inside a bundle shouldn't earn its own chip.
 */

/** Long enough to be stable, short enough to follow what the shop sells now. */
const LOOKBACK_DAYS = 180;

type FrequentSaleRow = {
  line_type: "PRODUCT" | "INSTALLATION" | "COMBO";
  inventory_item_id: string | null;
  combo_id: string | null;
  included_in_combo: boolean | null;
};

export function tallySaleUsage(rows: FrequentSaleRow[]): SaleUsageCounts {
  const counts: Record<string, number> = {};

  for (const row of rows) {
    if (row.line_type !== "PRODUCT" || !row.inventory_item_id) continue;
    // Expanded combo contents don't count toward the item's own popularity.
    if (row.included_in_combo) continue;

    const key = salePickerKey("ITEM", row.inventory_item_id);
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return counts;
}

export async function getSaleUsageCounts(supabase: SupabaseClient<Database>): Promise<SaleUsageCounts> {
  const since = new Date();
  since.setDate(since.getDate() - LOOKBACK_DAYS);

  const { data, error } = await supabase
    .from("sale_items")
    .select("line_type, inventory_item_id, combo_id, included_in_combo")
    .gte("created_at", since.toISOString());

  // Ranking is a convenience, never the difference between making a sale and
  // not — a failure here degrades to an unranked picker rather than a broken
  // page.
  if (error) return {};

  return tallySaleUsage((data ?? []) as unknown as FrequentSaleRow[]);
}
