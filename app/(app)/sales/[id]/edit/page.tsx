import { notFound, redirect } from "next/navigation";

import { requireSalesAccess } from "@/lib/auth/require-sales-access";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { listAllInventoryItemsForExport } from "@/services/inventory";
import { getSale, listAllCustomersForPicker, SaleNotFoundError } from "@/services/sales";
import { getSaleUsageCounts } from "@/services/sales/frequent";
import { getSaleRowActions, saleHasReturn } from "@/services/sales/sale-row-actions";
import { listActiveSalespeople } from "@/services/users";

import { NewSalePageClient } from "@/components/sales/new-sale-page-client";

type Params = { id: string };

/**
 * Correcting a recorded sale (doc/sales-edit-void-scope.md §3) — the same form
 * as New Sale, in edit mode.
 *
 * Who may open it is decided by getSaleRowActions(), the same function the list
 * row uses to decide whether to render the pencil. Deriving both from one place
 * is what makes it impossible for a visible Edit button to lead to a redirect —
 * and it means the two ways a sale becomes uncorrectable (voided, or a return
 * recorded against it) are stated once, not twice.
 */
export default async function EditSalePage({ params }: { params: Promise<Params> }) {
  const { role } = await requireSalesAccess();
  const { id } = await params;
  const supabase = await createClient();

  const sale = await getSale(supabase, id).catch((error) => {
    if (error instanceof SaleNotFoundError) notFound();
    throw error;
  });

  const canCorrect = role === "admin" || role === "sales_person";
  if (getSaleRowActions({ voidedAt: sale.voidedAt, hasReturn: saleHasReturn(sale) }, { canCorrect }).edit === null) {
    redirect("/sales");
  }

  // No Combo Offers fetch here (confirmed decision, 2026-08-15) — this page
  // can still display and save a sale's already-recorded combo line (that
  // reconstruction reads straight off `sale`, not off a sellable-combos
  // list), it just can't add a new one. See services/sales/picker.ts.
  const [items, customers, usageCounts, salespeople] = await Promise.all([
    listAllInventoryItemsForExport(supabase, {}),
    listAllCustomersForPicker(supabase),
    getSaleUsageCounts(supabase),
    listActiveSalespeople(supabase),
  ]);

  // Server-side, never `new Date()` in a client render body
  // (nextjs_ssr_hydration_standard).
  const todayLabel = formatDate(sale.saleDate);

  return (
    <NewSalePageClient
      existingSale={sale}
      items={items}
      customers={customers}
      usageCounts={usageCounts}
      salespeople={salespeople}
      todayLabel={todayLabel}
    />
  );
}
