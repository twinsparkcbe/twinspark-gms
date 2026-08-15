import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

export interface MechanicOption {
  id: string;
  fullName: string;
}

/**
 * Active Mechanics, for the Service Job assignment picker and the Service
 * list's "Assigned to" filter (doc/mechanic-role-scope.md §5).
 *
 * Reads through the caller's normal client, not the service-role one used by
 * the rest of services/users: `profiles_select_staff`
 * (0026_mechanic_access.sql) lets Admin and Mechanic read the roster, and a
 * Mechanic assigning a job must be able to see their colleagues. Deactivated
 * accounts are excluded here but stay visible on jobs they were already
 * assigned to — the job row joins the profile directly.
 */
export async function listActiveMechanics(supabase: SupabaseClient<Database>): Promise<MechanicOption[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("role", "mechanic")
    .eq("is_active", true)
    .order("full_name", { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({ id: row.id, fullName: row.full_name }));
}

export interface StaffOption {
  id: string;
  fullName: string;
}

/**
 * Active staff who can record a sale — Administrators and Sales Persons — for
 * the Sales form's "Sold by" picker and the Sales list's Sold-by filter
 * (doc/sales-edit-void-scope.md §2).
 *
 * Administrators are included on purpose: the owner sells at the counter too,
 * and a picker listing only staff would force their own sales to be either left
 * unassigned or credited to someone who wasn't there.
 *
 * Mechanics are excluded even though has_sales_access() includes them — the
 * question here is "whose sale is this", and a mechanic's work is attributed
 * through the Service job instead.
 *
 * Migration 0029 widened `profiles_select_staff` specifically so a Sales Person
 * can resolve this list; before that it was Admin and Mechanic only, and this
 * query came back empty for exactly the people who need it.
 */
export async function listActiveSalespeople(supabase: SupabaseClient<Database>): Promise<StaffOption[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("role", ["admin", "sales_person"])
    .eq("is_active", true)
    .order("full_name", { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({ id: row.id, fullName: row.full_name }));
}
