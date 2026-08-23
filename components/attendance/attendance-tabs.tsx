"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarCheck, FileBarChart, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Sub-navigation for the Attendance module.
 *
 * These are real routes, not a client-side <Tabs> widget: each tab does its
 * own server-side fetch, refresh/back/bookmark work, and the Reports tab
 * doesn't have to fetch on the client just because it shares a page with
 * Daily Attendance. The sidebar still shows one single "Attendance" entry —
 * resolveActiveHref() (components/layout/nav-items.ts) already highlights it
 * for every child route.
 */
const TABS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/attendance", label: "Daily Attendance", icon: CalendarCheck },
  { href: "/attendance/employees", label: "Employees", icon: Users },
  { href: "/attendance/reports", label: "Reports", icon: FileBarChart },
];

/** Longest-prefix match, same rule the sidebar uses — "/attendance" would
 * otherwise stay lit on "/attendance/employees". */
export function resolveActiveTab(pathname: string): string {
  let active = TABS[0].href;
  for (const tab of TABS) {
    const matches = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
    if (matches && tab.href.length > active.length) active = tab.href;
  }
  return active;
}

export function AttendanceTabs() {
  const pathname = usePathname();
  const activeHref = resolveActiveTab(pathname);

  return (
    <nav
      aria-label="Attendance sections"
      className="inline-flex w-full gap-1 overflow-x-auto rounded-[10px] border border-neutral-200 bg-white p-1 shadow-sm sm:w-fit"
    >
      {TABS.map((tab) => {
        const isActive = tab.href === activeHref;
        const Icon = tab.icon;

        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-[7px] px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand-red/40",
              isActive ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
            )}
          >
            <Icon className="size-4" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
