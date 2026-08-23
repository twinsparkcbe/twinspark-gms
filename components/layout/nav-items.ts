import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Boxes,
  CalendarCheck,
  ClipboardList,
  Globe,
  LayoutDashboard,
  ShoppingCart,
  Users,
  Settings,
  Receipt,
  Wrench,
} from "lucide-react";

import type { ModuleKey } from "@/lib/auth/permissions";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  moduleKey: ModuleKey;
};

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, moduleKey: "dashboard" },
  { label: "Inventory", href: "/inventory", icon: Boxes, moduleKey: "inventory" },
  { label: "Purchases", href: "/purchases", icon: ShoppingCart, moduleKey: "purchases" },
  { label: "Sales", href: "/sales", icon: Receipt, moduleKey: "sales" },
  { label: "Service", href: "/service", icon: Wrench, moduleKey: "service" },
  // Promoted out of the Service page header (2026-08-13) — it was a secondary
  // button you could only find once you were already on Service, which made
  // the catalog effectively undiscoverable. Same moduleKey as Service, so it
  // inherits the identical Admin-only gate with no extra permission wiring.
  //
  // Labelled "Services & Prices", not "Service Catalog": the route stays
  // /service/catalog, but "catalog" is retail jargon the garage owner doesn't
  // use. The label names what's on the screen and why you'd open it.
  { label: "Services & Prices", href: "/service/catalog", icon: ClipboardList, moduleKey: "service" },
  // No standalone "Billing" nav item — invoicing lives inside Sales/Service
  // (their own Invoice pages), never existed as a separate screen to link
  // to. Removed per request (2026-08-03); app/(app)/billing/page.tsx is
  // still a ModulePlaceholder stub, just unreachable from the sidebar now.
  { label: "Customers & Vehicles", href: "/customers", icon: Users, moduleKey: "customers" },
  { label: "Online Orders", href: "/online-orders", icon: Globe, moduleKey: "online-orders" },
  { label: "Reports", href: "/reports", icon: BarChart3, moduleKey: "reports" },
  // Attendance Management — one nav entry, not three. Daily Attendance /
  // Employees / Reports are child routes of /attendance rendered behind a tab
  // bar (app/(app)/attendance/layout.tsx), so resolveActiveHref below already
  // highlights this single item for all of them. Deliberately sits between
  // Reports and Settings: it is a daily-use screen, not configuration.
  { label: "Attendance", href: "/attendance", icon: CalendarCheck, moduleKey: "attendance" },
  { label: "Settings / Users", href: "/settings/users", icon: Settings, moduleKey: "settings" },
  // Payment QR Config (doc/payment-qr-config-scope.md) — same moduleKey as
  // Settings / Users, so it inherits the identical Admin-only gate with no
  // extra permission wiring, same pattern as Services & Prices above.
  { label: "Settings / Payment", href: "/settings/payment", icon: Settings, moduleKey: "settings" },
];

/**
 * Which nav item should render as active for the current path — the **longest**
 * matching href, not merely the first.
 *
 * This matters because nav hrefs now nest: `/service/catalog` is a prefix match
 * for both "Service" and "Service Catalog". A naive per-item check lights up
 * both, and since the active pill is a framer-motion `layoutId` element, two
 * simultaneous matches mean two nodes sharing one layoutId — which breaks the
 * animation, not just the highlight.
 *
 * Returns null when nothing matches (e.g. a route with no nav entry), so no
 * item is highlighted rather than an arbitrary one.
 */
export function resolveActiveHref(pathname: string, items: NavItem[]): string | null {
  let active: string | null = null;

  for (const item of items) {
    const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (matches && (active === null || item.href.length > active.length)) {
      active = item.href;
    }
  }

  return active;
}
