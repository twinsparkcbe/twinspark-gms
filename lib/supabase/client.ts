import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY env vars."
  );
}

/**
 * Supabase client for use in Client Components ("use client").
 * Call this inside the component/hook that needs it — don't hoist to a
 * shared singleton across server/client boundaries.
 *
 * See the matching comment in `lib/supabase/server.ts` for why this cast is
 * needed — `@supabase/ssr@0.5.2`'s declared return type predates
 * `@supabase/supabase-js@2.110.0`'s generic signature.
 */
export const createClient = () =>
  createBrowserClient<Database>(supabaseUrl, supabaseKey) as unknown as SupabaseClient<Database>;
