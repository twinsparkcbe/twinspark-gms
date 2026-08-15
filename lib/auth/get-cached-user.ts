import "server-only";
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

/** The only auth fields anything downstream of this actually reads. Role and
 * active status deliberately are NOT here — those come from `profiles` in
 * getSessionAccess(), never from the token, so deactivating a user takes
 * effect on their very next request instead of at their next JWT refresh. */
export interface AuthUser {
  id: string;
  email: string | null;
}

/**
 * Resolves the signed-in user for Server Components.
 *
 * Uses `supabase.auth.getClaims()`, which verifies the access token's
 * signature locally with WebCrypto against a cached JWKS. The previous
 * `getUser()` re-validated the session against the Supabase Auth server on
 * every call — secure, but a real network round trip on the critical path of
 * every navigation. `getClaims()` gives the same "this token is genuinely
 * signed by our project" guarantee without that hop. (On a project still
 * using a symmetric JWT secret it transparently falls back to a server call,
 * so this is safe regardless of the project's signing-key setting — it's
 * just only *faster* on asymmetric keys.)
 *
 * Still `cache()`-wrapped: React dedupes calls within a single request's
 * render pass, so the layout and each page's requireAdmin()/requireAuth()
 * guard share one verification instead of each doing its own.
 */
export const getCachedUser = cache(async (): Promise<AuthUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  // An invalid/expired token resolves with an error rather than throwing —
  // treat it exactly like "no session" so guards redirect to /login.
  if (error || !data?.claims?.sub) return null;

  return {
    id: data.claims.sub,
    email: typeof data.claims.email === "string" ? data.claims.email : null,
  };
});
