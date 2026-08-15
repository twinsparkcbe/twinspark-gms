import { requireAdmin } from "@/lib/auth/require-admin";
import { createClient } from "@/lib/supabase/server";
import { getInventoryStats, listInventoryItems } from "@/services/inventory";
import { listAgeingStock } from "@/services/reports";

import { InventoryReportClient } from "@/components/reports/inventory-report-client";

const AGEING_MONTHS = 6;

export default async function InventoryReportPage() {
  await requireAdmin();
  const supabase = await createClient();

  const [{ items, total }, stats, ageingRows] = await Promise.all([
    listInventoryItems(supabase, { page: 1, pageSize: 200 }),
    getInventoryStats(supabase),
    listAgeingStock(supabase, AGEING_MONTHS),
  ]);

  return (
    <InventoryReportClient
      initialItems={items}
      initialTotal={total}
      stats={stats}
      ageingItemIds={ageingRows.map((r) => r.inventoryItemId)}
    />
  );
}
