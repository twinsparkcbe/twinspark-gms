import "server-only";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { getLandingPath } from "./landing-path";
import { getSessionAccess } from "./get-session-access";

import type { UserRole } from "./permissions";

/**
 * Server-side guard for Admin-only pages (Inventory, Purchases, Reports,
 * Settings, User Roles). The sidebar already hides these routes for Sales
 * Person, but hiding a nav link doesn't stop someone from typing the URL
 * directly — this is what actually blocks the request (INV-056/057).
 *
 * role/is_active now come from `profiles` via getSessionAccess() (User Roles
 * module, 0020_user_roles_profiles.sql) instead of the old `user_metadata`
 * stopgap. INV-059's deactivated-user check is implemented here: a
 * deactivated account is signed out and redirected, not just blocked —
 * every request re-checks `is_active` with a fresh DB read, so deactivation
 * takes effect immediately rather than waiting for the session's JWT to
 * next refresh.
 */
export async function requireAdmin(): Promise<{ userId: string; email: string; role: UserRole }> {
  const access = await getSessionAccess();

  if (!access) {
    redirect("/login");
  }

  if (!access.isActive) {
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect("/login");
  }

  // Redirect target must be a page this role can actually reach — this was
  // "/dashboard" before, which is itself Admin-only (requireAdmin() again)
  // and looped a Sales Person straight back here. getLandingPath() keeps
  // that decision in one place: Sales Person -> /sales, Mechanic -> /service.
  if (access.role !== "admin") {
    redirect(getLandingPath(access.role));
  }

  return { userId: access.userId, email: access.email, role: access.role };
}
