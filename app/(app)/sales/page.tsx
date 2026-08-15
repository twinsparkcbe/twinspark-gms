import { requireSalesAccess } from "@/lib/auth/require-sales-access";
import { createClient } from "@/lib/supabase/server";
import { getSalesStats, listSales } from "@/services/sales";
import { listActiveSalespeople } from "@/services/users";

import { SalesPageClient } from "@/components/sales/sales-page-client";

// Both Administrator and Sales Person can access this page (scope doc §1) —
// the one module Sales Person gets real working access to, unlike
// requireAdmin()'s gate on Inventory/Purchases/Reports/Settings.
export default async function SalesPage() {
  const { role } = await requireSalesAccess();
  const supabase = await createClient();

  const [{ sales, total }, stats, salespeople] = await Promise.all([
    listSales(supabase, { page: 1, pageSize: 10 }),
    getSalesStats(supabase),
    // Powers the Sold-by filter (doc/sales-edit-void-scope.md §2) — fetched
    // here rather than client-side since the list itself already round-trips
    // through the server on first load.
    listActiveSalespeople(supabase),
  ]);

  return (
    <SalesPageClient
      initialSales={sales}
      initialTotal={total}
      initialStats={stats}
      role={role}
      salespeople={salespeople}
    />
  );
}
