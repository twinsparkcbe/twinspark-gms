"use server";

import { requireAdmin } from "@/lib/auth/require-admin";
import { createClient } from "@/lib/supabase/server";
import { getDashboardStats, resolveDateRangePreset, type DashboardStats, type DateRangePreset } from "@/services/dashboard";

type ActionResult<T = undefined> = { success: true; data: T } | { success: false; error: string };

function toErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** Every action re-checks Admin access server-side — never trust the client. */
async function adminClient() {
  await requireAdmin();
  return createClient();
}

/**
 * Powers the Dashboard's date-range filter — resolves the chosen preset (or
 * explicit custom from/to) into concrete instants server-side (never trusts
 * a client-computed date range) and refetches the stat cards for that
 * period. Track Tyre Stock inside the result stays a live snapshot
 * regardless of the range (see getDashboardStats' own doc comment).
 */
export async function fetchDashboardStatsAction(
  preset: DateRangePreset,
  custom?: { fromYMD: string; toYMD: string }
): Promise<ActionResult<DashboardStats>> {
  try {
    const supabase = await adminClient();
    const range = resolveDateRangePreset(preset, new Date(), custom);
    // The preset travels alongside the resolved range because it's what
    // decides how far back the comparison window sits — a duration-matched
    // slice for an in-progress period, a whole calendar month for "Last
    // Month" (services/dashboard/previous-period.ts).
    const data = await getDashboardStats(supabase, { preset, range });
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load stats for that date range.") };
  }
}
