import "server-only";

import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * Service-role Supabase client — bypasses RLS entirely and can call the
 * `auth.admin.*` API (create/update/delete users, set passwords). Used ONLY
 * by services/users/users.ts, and only ever reached from server actions that
 * call requireAdmin() first (app/(app)/settings/users/actions.ts). Never
 * import this from a Client Component or anywhere the key could end up in a
 * bundle sent to the browser — `server-only` above enforces that at build
 * time.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY (Project Settings > API > service_role
 * in the Supabase dashboard) — a new env var this module introduces, not
 * present before. Set it in .env.local and in the hosting provider's env,
 * never commit the real value (see .env.example).
 */
export function createAdminClient(): SupabaseClient<Database> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars — required for User Management (services/users)."
    );
  }

  return createSupabaseClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
