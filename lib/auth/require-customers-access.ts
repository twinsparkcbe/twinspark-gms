import "server-only";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { getSessionAccess } from "./get-session-access";

import type { UserRole } from "./permissions";

/**
 * Server-side guard for the Customer & Vehicle module's landing/directory
 * page and Customer Detail — both Administrator and Sales Person get real
 * access here (doc/customer-vehicle-scope.md §3, spec §6: Customer
 * Management is ✅ for both roles), same access shape as
 * requireSalesAccess()/requireOnlineOrdersAccess(). Kept as its own guard
 * (rather than reusing one of those directly) for the same reasons as
 * requireOnlineOrdersAccess: lets this module's access rule diverge later
 * without silently changing another module's guard, and keeps a permission
 * grep for "customers" self-contained.
 *
 * This only gates *whether the page loads at all*. Within the page, which
 * sections render (Vehicles, Service History) is a separate, finer-grained
 * rule — see getCustomerVehicleVisibility() in ./customer-vehicle-visibility.
 * The Vehicle Detail route (/customers/vehicles/[id]) is guarded by
 * requireAdmin() directly instead, since Vehicle Management has no
 * Sales-Person access at all, not even a redacted view.
 */
export async function requireCustomersAccess(): Promise<{ userId: string; email: string; role: UserRole }> {
  const access = await getSessionAccess();

  if (!access) {
    redirect("/login");
  }

  if (!access.isActive) {
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect("/login");
  }

  // Both roles are allowed here.
  return { userId: access.userId, email: access.email, role: access.role };
}
