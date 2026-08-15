import { redirect } from "next/navigation";

import { getSessionAccess } from "@/lib/auth/get-session-access";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Cached per-request (see get-session-access.ts) — admin-gated pages that
  // also call requireAdmin() reuse this instead of hitting Supabase/Postgres
  // twice.
  const access = await getSessionAccess();

  // Defense in depth — middleware.ts already redirects unauthenticated
  // requests, but Server Components should never assume that ran.
  if (!access) {
    redirect("/login");
  }

  // Deactivated account (User Roles module, profiles.is_active) — signed out
  // and sent back to login immediately, same as every requireXAccess() guard.
  if (!access.isActive) {
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect("/login");
  }

  const role = access.role;
  const fullName = access.fullName ?? undefined;

  return (
    <div className="flex min-h-screen bg-neutral-50 print:block print:min-h-0 print:bg-white">
      {/* print:hidden on the nav shell — pages like the Sales Invoice
          (app/(app)/sales/[id]/invoice) rely on this so window.print()
          only sends the document itself to the printer, never the
          sidebar/header chrome around it. */}
      <div className="print:hidden">
        <Sidebar role={role} email={access.email} fullName={fullName} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col print:block">
        <div className="print:hidden">
          {/* Header carries the identity props because the mobile menu button
              lives in it, and that opens the same sidebar nav. */}
          <Header role={role} email={access.email} fullName={fullName} />
        </div>
        <main className="flex-1 p-4 sm:p-6 lg:p-8 print:p-0">
          <div className="mx-auto max-w-7xl print:max-w-none">{children}</div>
        </main>
      </div>
    </div>
  );
}
