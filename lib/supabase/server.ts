import "server-only";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import type { Database } from "@/types/database.types";

/**
 * Supabase client for use in Server Components, Server Actions, and Route Handlers.
 * Reads/writes the auth cookie via Next.js `cookies()`.
 *
 * NOTE: `setAll` will throw when called from a Server Component (cookies are
 * read-only there). That's expected and safe to ignore as long as
 * `middleware.ts` is refreshing the session on every request.
 */
export async function createClient(): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY env vars."
    );
  }

  // `@supabase/ssr@0.5.2`'s bundled `.d.ts` was compiled against an older
  // `@supabase/supabase-js` generic signature (3 type params) than the
  // installed `@supabase/supabase-js@2.110.0` (5 type params), so its
  // declared return type doesn't structurally match `SupabaseClient<Database>`
  // even though it's the exact same class at runtime. Contain the cast here
  // so every caller of `createClient()` just sees the clean, current type.
  return createServerClient<Database>(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Called from a Server Component — safe to ignore because
          // middleware.ts refreshes the session on every request.
        }
      },
    },
  }) as unknown as SupabaseClient<Database>;
}
