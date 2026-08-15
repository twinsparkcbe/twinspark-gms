import "server-only";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { getLandingPath } from "./landing-path";
import { getSessionAccess } from "./get-session-access";

import type { UserRole } from "./permissions";

/**
 * Server-side guard for the Service Job lifecycle — Administrator and
 * Mechanic only (doc/mechanic-role-scope.md §4). Sales Person has zero
 * Service access, not even read-only, so they are bounced to their own
 * landing page rather than shown a redacted screen.
 *
 * /service/catalog stays on requireAdmin() instead: catalog management is
 * price-list setup, not shop-floor work (canManageServiceCatalog()).
 *
 * role/is_active come from `profiles` via getSessionAccess(), so a
 * deactivated account is signed out immediately, same as every other guard.
 */
export async function requireServiceAccess(): Promise<{ userId: string; email: string; role: UserRole }> {
  const access = await getSessionAccess();

  if (!access) {
    redirect("/login");
  }

  if (!access.isActive) {
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect("/login");
  }

  if (access.role !== "admin" && access.role !== "mechanic") {
    redirect(getLandingPath(access.role));
  }

  return { userId: access.userId, email: access.email, role: access.role };
}
