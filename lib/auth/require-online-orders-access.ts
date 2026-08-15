import "server-only";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { getSessionAccess } from "./get-session-access";

import type { UserRole } from "./permissions";

/**
 * Server-side guard for the Online Orders queue/workflow (verify, approve,
 * dispatch, reject, courier labels) — both Administrator and Sales Person
 * get full access here (doc/online-orders-scope.md §5, confirmed default:
 * Sales Person gets Approve too, not just Verify/Dispatch), same access
 * shape as requireSalesAccess(). Kept as its own guard (rather than reusing
 * requireSalesAccess directly) so this module's access rule can diverge
 * later without silently changing Sales' guard too, and so a permission
 * grep for "online-orders" turns up its own file.
 *
 * The public order submission page (app/order) is intentionally NOT behind
 * this guard, or any guard — it's outside the Administrator/Sales Person
 * model entirely, by design (doc/online-orders-scope.md §1).
 */
export async function requireOnlineOrdersAccess(): Promise<{ userId: string; email: string; role: UserRole }> {
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
