import "server-only";
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

import { getCachedUser } from "./get-cached-user";

import type { UserRole } from "./permissions";

export interface SessionAccess {
  userId: string;
  email: string;
  fullName: string | null;
  role: UserRole;
  /** False for a deactivated account, or one with no `profiles` row at all
   * (shouldn't happen post-backfill, but fails closed rather than open). */
  isActive: boolean;
}

/**
 * Resolves the current session's role/active status from `profiles` — the
 * User Roles module's real source of truth (0020_user_roles_profiles.sql),
 * replacing the `user_metadata.role` stopgap every guard used before. Reads
 * through the normal authenticated client, which can only ever see its own
 * row (`profiles_select_own` RLS policy) — this never needs the service-role
 * client, unlike the Admin CRUD in services/users/users.ts.
 *
 * `cache()`-wrapped so every guard/layout in a single request's render tree
 * shares one profile lookup instead of each firing its own (same reasoning
 * as getCachedUser()).
 */
export const getSessionAccess = cache(async (): Promise<SessionAccess | null> => {
  const user = await getCachedUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, is_active")
    .eq("id", user.id)
    .maybeSingle();

  // No profile row: treat as inactive/most-restricted rather than trusting
  // stale user_metadata — fails closed. Shouldn't happen once every user is
  // backfilled/created through this module, but a request should never
  // silently fall back to full access if that ever drifts.
  if (!profile) {
    return { userId: user.id, email: user.email ?? "", fullName: null, role: "sales_person", isActive: false };
  }

  return {
    userId: user.id,
    email: user.email ?? "",
    fullName: profile.full_name,
    role: profile.role,
    isActive: profile.is_active,
  };
});
