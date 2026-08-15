import { requireAdmin } from "@/lib/auth/require-admin";
import { createClient } from "@/lib/supabase/server";
import { listAllInventoryItemsForExport, listBrands } from "@/services/inventory";
import { getPurchaseStats, listPurchaseEntries } from "@/services/purchases";

import { PurchasePageClient } from "@/components/purchases/purchase-page-client";

// Server-side Admin gate (mirrors app/(app)/inventory/page.tsx) — the
// sidebar already hides this link for Sales Person, but that doesn't stop a
// direct navigation.
export default async function PurchasesPage() {
  await requireAdmin();
  const supabase = await createClient();

  const [{ entries, total }, brands, stats, items] = await Promise.all([
    listPurchaseEntries(supabase, { page: 1, pageSize: 20 }),
    listBrands(supabase),
    getPurchaseStats(supabase),
    listAllInventoryItemsForExport(supabase, {}),
  ]);

  return (
    <PurchasePageClient
      initialEntries={entries}
      initialTotal={total}
      brands={brands}
      initialStats={stats}
      initialItems={items}
    />
  );
}
