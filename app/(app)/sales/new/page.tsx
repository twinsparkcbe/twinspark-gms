import { requireSalesAccess } from "@/lib/auth/require-sales-access";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { listAllInventoryItemsForExport } from "@/services/inventory";
import { listAllCustomersForPicker } from "@/services/sales";
import { getSaleUsageCounts } from "@/services/sales/frequent";
import { listActiveSalespeople } from "@/services/users";

import { NewSalePageClient } from "@/components/sales/new-sale-page-client";

// Dedicated page, not a modal (scope doc §10) — a sale is a running list
// mixing product and installation lines plus customer/GST/discount/total,
// more than a Record-Purchase-style modal comfortably fits.
//
// No Combo Offers here (confirmed decision, 2026-08-15) — Sale Items only
// ever offers products and Tyre Fitting, so this page no longer fetches the
// sellable-combos list. See services/sales/picker.ts.
export default async function NewSalePage() {
  const { userId } = await requireSalesAccess();
  const supabase = await createClient();

  const [items, customers, usageCounts, salespeople] = await Promise.all([
    listAllInventoryItemsForExport(supabase, {}),
    listAllCustomersForPicker(supabase),
    getSaleUsageCounts(supabase),
    // Powers the "Sold by" picker (doc/sales-edit-void-scope.md §2) — same
    // list the Sales list's Sold-by filter draws from.
    listActiveSalespeople(supabase),
  ]);

  // Computed server-side and passed down as a plain string — never
  // `new Date()` directly inside a client component's render body, which
  // would risk a hydration mismatch (nextjs_ssr_hydration_standard).
  const todayLabel = formatDate(new Date().toISOString());

  return (
    <NewSalePageClient
      items={items}
      customers={customers}
      usageCounts={usageCounts}
      salespeople={salespeople}
      // Pre-selects whoever's signed in — a counter sale is almost always
      // recorded by the person who made it.
      defaultSoldById={userId}
      todayLabel={todayLabel}
    />
  );
}
