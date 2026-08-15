import "server-only";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { getSessionAccess } from "./get-session-access";

import type { UserRole } from "./permissions";

/**
 * Server-side guard for Sales — the first module both Administrator and
 * Sales Person get real working access to (doc/sales-module-scope.md §1),
 * unlike requireAdmin()'s Inventory/Purchases/Reports/Settings gate. The
 * sidebar already hides Sales-adjacent links from nobody (both roles see
 * it), but this is what actually blocks a request if role/active status is
 * missing or wrong — same defense-in-depth reasoning as requireAdmin().
 *
 * role/is_active come from `profiles` via getSessionAccess() (User Roles
 * module) — a deactivated account is signed out and redirected immediately,
 * same as requireAdmin().
 */
export async function requireSalesAccess(): Promise<{ userId: string; email: string; role: UserRole }> {
  const access = await getSessionAccess();

  if (!access) {
    redirect("/login");
  }

  if (!access.isActive) {
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect("/login");
  }

  // Both roles are allowed here (that's the point of this guard vs
  // requireAdmin).
  return { userId: access.userId, email: access.email, role: access.role };
}
