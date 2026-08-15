"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import type { UserRole } from "@/lib/auth/permissions";

import { MobileSidebar } from "./mobile-sidebar";
import { NAV_ITEMS, resolveActiveHref } from "./nav-items";

// Topbar: menu button (mobile only) + breadcrumb left, live system status
// right. Account identity + sign-out live in the Sidebar footer, not here.
export function Header({
  role,
  email,
  fullName,
}: {
  role: UserRole;
  email: string;
  fullName?: string;
}) {
  const pathname = usePathname();
  // Same longest-match resolution the sidebar uses, so the breadcrumb reads
  // "Services & Prices" on /service/catalog rather than "Service".
  const activeHref = resolveActiveHref(pathname, NAV_ITEMS);
  const section = NAV_ITEMS.find((item) => item.href === activeHref)?.label ?? "Overview";

  // Rendered only after mount to avoid a server/client date mismatch.
  const [utcDate, setUtcDate] = useState<string | null>(null);
  useEffect(() => {
    setUtcDate(new Date().toISOString().slice(0, 10));
  }, []);

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-neutral-200 bg-white px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <MobileSidebar role={role} email={email} fullName={fullName} />
        {/* The workspace prefix is the first thing to go on a narrow screen —
            it's constant, so it carries no information the user needs. */}
        <span className="hidden font-medium tracking-wide text-neutral-400 uppercase sm:inline">
          Twinspark Workspace
        </span>
        <span className="hidden text-neutral-300 sm:inline">/</span>
        <span className="truncate font-semibold tracking-wide text-neutral-900 uppercase">{section}</span>
      </div>

      <div className="flex shrink-0 items-center gap-2 font-mono text-[11px] font-bold tracking-wide text-neutral-500 uppercase">
        {utcDate && <span className="hidden md:inline">System Time UTC: {utcDate}</span>}
        <span className="relative flex size-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/60" />
          <span className="relative inline-flex size-2 rounded-full bg-success" />
        </span>
      </div>
    </header>
  );
}
