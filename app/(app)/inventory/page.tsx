import { requireAdmin } from "@/lib/auth/require-admin";
import { createClient } from "@/lib/supabase/server";
import { getInventoryStats, listBrands, listInventoryItems, listReorderItems } from "@/services/inventory";

import { InventoryPageClient } from "@/components/inventory/inventory-page-client";

// Server-side Admin gate (INV-056/057) — the sidebar already hides this link
// for Sales Person, but that doesn't stop a direct navigation.
export default async function InventoryPage() {
  await requireAdmin();
  const supabase = await createClient();

  // No sortBy passed: listInventoryItems now defaults to urgency, so the first
  // paint already leads with the items needing action.
  const [{ items, total }, brands, stats, reorderItems] = await Promise.all([
    listInventoryItems(supabase, { page: 1, pageSize: 20 }),
    listBrands(supabase),
    getInventoryStats(supabase),
    listReorderItems(supabase),
  ]);

  return (
    <InventoryPageClient
      initialItems={items}
      initialTotal={total}
      brands={brands}
      initialStats={stats}
      initialReorderItems={reorderItems}
    />
  );
}
