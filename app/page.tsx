import { redirect } from "next/navigation";

import { getLandingPath } from "@/lib/auth/landing-path";
import { getSessionAccess } from "@/lib/auth/get-session-access";

/**
 * Single role-aware landing router — everywhere that used to redirect
 * straight to "/dashboard" (root, and the login form on sign-in success)
 * now redirects here instead, so the "where does this role land" decision
 * lives in exactly one place. Dashboard is Admin-only (spec §6); a Sales
 * Person lands on Sales and a Mechanic on Service — the first module each
 * actually has access to (lib/auth/landing-path.ts).
 */
export default async function RootPage() {
  const access = await getSessionAccess();

  if (!access) {
    redirect("/login");
  }

  redirect(getLandingPath(access.role));
}
