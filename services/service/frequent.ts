import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, ServiceLineType } from "@/types/database.types";

import { pickerKey, type UsageCounts } from "./picker";

/**
 * "Most-used services" ranking (rework plan Change 1, test cases §B).
 *
 * Drives two things: the one-tap chip row above the picker, and the
 * tie-breaking order inside search results. A garage bills the same handful
 * of services all day — surfacing those turns the common case into a single
 * tap without needing a hand-managed "favourites" feature (doc §22).
 *
 * Counts come from history, not from a counter column, so nothing extra has
 * to be maintained on the write path and the ranking self-corrects as the
 * shop's habits change.
 */

export interface FrequentServiceRow {
  /** Matches `PickerEntry.key` — `PACKAGE:<id>` or `SPECIFIC:<id>`. */
  key: string;
  kind: "PACKAGE" | "SPECIFIC";
  id: string;
  name: string;
  usageCount: number;
}

export interface RankableLine {
  lineType: ServiceLineType;
  generalServicePackageId: string | null;
  specificServiceId: string | null;
  description: string;
}

/**
 * Pure ranking step, split out from the query so it can be tested without a
 * database.
 *
 * @param activeKeys Keys still active in the catalog. A service that was
 *   deactivated must not keep appearing as a chip however often it was
 *   billed last year (doc §16 — deactivated, never deleted).
 */
export function rankByUsage(
  lines: RankableLine[],
  { activeKeys, limit = 6 }: { activeKeys: ReadonlySet<string>; limit?: number }
): FrequentServiceRow[] {
  const tally = new Map<string, FrequentServiceRow>();

  for (const line of lines) {
    // CUSTOM lines have no catalog id, so there's nothing a chip could
    // re-add — they're one-off work by definition (doc §8).
    if (line.lineType === "CUSTOM") continue;

    const kind = line.lineType === "PACKAGE" ? "PACKAGE" : "SPECIFIC";
    const id = kind === "PACKAGE" ? line.generalServicePackageId : line.specificServiceId;
    if (!id) continue;

    const key = pickerKey(kind, id);
    if (!activeKeys.has(key)) continue;

    const existing = tally.get(key);
    if (existing) {
      existing.usageCount += 1;
    } else {
      tally.set(key, { key, kind, id, name: line.description, usageCount: 1 });
    }
  }

  return [...tally.values()]
    .sort((a, b) => {
      if (a.usageCount !== b.usageCount) return b.usageCount - a.usageCount;
      // Alphabetical tie-break keeps chip order stable between page loads —
      // muscle memory matters more here than any cleverer ordering.
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit);
}

/** Turns the ranking into the lookup `buildPickerIndex` expects. */
export function toUsageCounts(rows: FrequentServiceRow[]): UsageCounts {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.key] = row.usageCount;
  return counts;
}

type FrequentJoinedRow = {
  line_type: ServiceLineType;
  general_service_package_id: string | null;
  specific_service_id: string | null;
  description: string;
  service_jobs: { status: string } | { status: string }[] | null;
};

/** How far back the ranking looks. Long enough to be stable, short enough
 * that the chips follow what the shop is doing now, not two years ago. */
const LOOKBACK_DAYS = 180;

/**
 * Reads billed service lines from COMPLETED jobs only — a draft that was
 * never finished, or a cancelled one, says nothing about what the shop
 * actually sells (doc §23, same cut as every other reported figure).
 *
 * @param activeKeys Active catalog keys, built by the caller from the
 *   package/service lists it has already loaded — avoids a second round trip.
 */
export async function getFrequentServices(
  supabase: SupabaseClient<Database>,
  { activeKeys, limit = 6 }: { activeKeys: ReadonlySet<string>; limit?: number }
): Promise<FrequentServiceRow[]> {
  const since = new Date();
  since.setDate(since.getDate() - LOOKBACK_DAYS);

  const { data, error } = await supabase
    .from("service_job_lines")
    .select("line_type, general_service_package_id, specific_service_id, description, service_jobs!inner(status)")
    .eq("service_jobs.status", "COMPLETED")
    .gte("created_at", since.toISOString());

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as FrequentJoinedRow[];

  return rankByUsage(
    rows.map((row) => ({
      lineType: row.line_type,
      generalServicePackageId: row.general_service_package_id,
      specificServiceId: row.specific_service_id,
      description: row.description,
    })),
    { activeKeys, limit }
  );
}
