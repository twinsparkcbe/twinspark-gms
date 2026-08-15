import { requireAdmin } from "@/lib/auth/require-admin";
import { createClient } from "@/lib/supabase/server";
import { listCombos } from "@/services/combos";
import { listGeneralServicePackages, listSpecificServices } from "@/services/service";
import { listAllInventoryItemsForExport } from "@/services/inventory";

import { CatalogPageClient } from "@/components/service/catalog-page-client";

export default async function ServiceCatalogPage() {
  await requireAdmin();
  const supabase = await createClient();

  // activeOnly=false everywhere: the management screen must show switched-off
  // entries so they can be switched back on.
  const [packages, specificServices, combos, items] = await Promise.all([
    listGeneralServicePackages(supabase, false),
    listSpecificServices(supabase, false),
    listCombos(supabase, false),
    listAllInventoryItemsForExport(supabase, {}),
  ]);

  return (
    <CatalogPageClient initialPackages={packages} initialSpecificServices={specificServices} initialCombos={combos} items={items} />
  );
}
