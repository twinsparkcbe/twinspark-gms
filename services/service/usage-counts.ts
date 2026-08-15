import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

import type { GeneralServicePackageRow, SpecificServiceRow } from "./catalog";
import { getFrequentServices, toUsageCounts } from "./frequent";
import { pickerKey, type UsageCounts } from "./picker";

/**
 * Loads the picker's usage ranking for a page that has already fetched the
 * active catalogs (rework plan Change 1).
 *
 * Small wrapper so `/service/new` and `/service/[id]/edit` don't each
 * re-derive the "which keys are still active" set — and so a failure here
 * degrades to an unranked picker rather than a broken page: the ranking is
 * a convenience, never the difference between billing a job and not.
 */
export async function getPickerUsageCounts(
  supabase: SupabaseClient<Database>,
  { packages, specificServices }: { packages: GeneralServicePackageRow[]; specificServices: SpecificServiceRow[] }
): Promise<UsageCounts> {
  const activeKeys = new Set<string>([
    ...packages.filter((p) => p.isActive).map((p) => pickerKey("PACKAGE", p.id)),
    ...specificServices.filter((s) => s.isActive).map((s) => pickerKey("SPECIFIC", s.id)),
  ]);

  try {
    return toUsageCounts(await getFrequentServices(supabase, { activeKeys, limit: activeKeys.size || 1 }));
  } catch {
    return {};
  }
}
