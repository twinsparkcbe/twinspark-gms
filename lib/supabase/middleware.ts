import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/types/database.types";

// Routes that don't require an authenticated session. "/order" is the
// public, unauthenticated Track Tyre order form (doc/online-orders-scope.md
// §1) — the first genuinely public page in the app, not a login-adjacent
// route like the other two.
const PUBLIC_PATHS = ["/login", "/auth/callback", "/order"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathname.startsWith(path));
}

/**
 * Refreshes the Supabase auth session on every request and redirects
 * unauthenticated users away from protected routes. Called from the root
 * middleware.ts.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY env vars."
    );
  }

  const supabase = createServerClient<Database>(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // IMPORTANT: do not run code between createServerClient and the auth call
  // below. A simple mistake could make it very hard to debug issues with
  // users being randomly logged out.
  //
  // getClaims() rather than getUser(): getUser() sends a request to the
  // Supabase Auth server on *every* request this middleware handles — which
  // is every page load and every client-side navigation's RSC fetch — adding
  // a full round trip before the page even starts rendering. getClaims()
  // verifies the JWT signature locally via WebCrypto against a cached JWKS,
  // so it's the same security guarantee (a real signature check, not the
  // unverified cookie read that getSession() does) without the per-request
  // network hop. It still refreshes an about-to-expire session first, so the
  // cookie-rotation behaviour below is unchanged.
  //
  // NOTE: this only avoids the network call if the Supabase project uses
  // asymmetric JWT signing keys (ES256/RS256). On a legacy symmetric secret
  // getClaims() falls back to a server call and behaves exactly like
  // getUser() — correct either way, just not faster.
  const { data: claimsData } = await supabase.auth.getClaims();
  const user = claimsData?.claims ?? null;

  if (!user && !isPublicPath(request.nextUrl.pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("redirectedFrom", request.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // IMPORTANT: Any response created here must copy over supabaseResponse's
  // cookies, or the browser and server will get out of sync.
  return supabaseResponse;
}
