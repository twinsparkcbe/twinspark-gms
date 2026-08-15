"use client";

import { useCallback, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ChevronDown, LogOut } from "lucide-react";

import { cn } from "@/lib/utils";
import { canAccessModule, type UserRole } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { BrandMark } from "@/components/shared/brand-mark";

import { NAV_ITEMS, resolveActiveHref } from "./nav-items";

export interface SidebarProps {
  role: UserRole;
  email: string;
  fullName?: string;
}

// Sidebar: 264px, sticky, dark-slate gradient chrome, animated active pill
// (framer-motion layoutId), glass profile card. See twinspark-style-guide.md
// §13 for why gradients/backdrop-blur are allowed here specifically.
//
// The inner content is split out as SidebarNav so the mobile drawer
// (mobile-sidebar.tsx) renders the exact same nav rather than a second,
// drifting copy of it.
export function Sidebar(props: SidebarProps) {
  return (
    <aside className="sticky top-0 hidden h-screen w-[264px] shrink-0 flex-col border-r border-white/5 bg-gradient-to-b from-brand-black to-brand-black-soft text-white lg:flex">
      <SidebarNav {...props} variant="desktop" />
    </aside>
  );
}

export function SidebarNav({
  role,
  email,
  fullName,
  variant,
  onNavigate,
}: SidebarProps & {
  /** Desktop rail and mobile drawer can both be mounted at once (open the
   * drawer, then widen the window). They must not share a framer-motion
   * layoutId — two nodes on one layoutId makes the active pill fly between
   * them — so the id is namespaced per variant. */
  variant: "desktop" | "mobile";
  /** Called after a nav link is followed, so the drawer can close itself. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();

  // Every module route is dynamic (Supabase auth cookies), and Next 15's
  // automatic <Link> prefetch only warms the loading.tsx boundary for those —
  // not the page's own data — so a click still paid for a full server render.
  // Prefetching on hover/focus instead warms the real RSC payload a few
  // hundred ms before the click lands, which is usually enough to make the
  // navigation feel instant. Deliberately NOT prefetch={true} on the Links:
  // all nav items are in the viewport at once, so that would fire a full
  // render of all module pages on every app load.
  const prefetched = useRef<Set<string>>(new Set());

  const warmRoute = useCallback(
    (href: string) => {
      if (prefetched.current.has(href)) return;
      prefetched.current.add(href);
      router.prefetch(href);
    },
    [router]
  );

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const displayName = fullName || email;
  const initials = (fullName ?? email).slice(0, 2).toUpperCase();
  const roleLabel = role === "admin" ? "Admin Account" : "Sales Account";
  const visibleItems = NAV_ITEMS.filter((item) => canAccessModule(role, item.moduleKey));
  // Resolved once across all items rather than per-item, so exactly one can
  // ever be active — see resolveActiveHref for why that's load-bearing.
  const activeHref = resolveActiveHref(pathname, visibleItems);

  return (
    <>
      <div className="flex items-center gap-3 px-5 py-6">
        <BrandMark variant="sidebar" className="shadow-lg shadow-black/40" />
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[15px] font-black tracking-tight text-white">Twinspark</div>
          <div className="truncate bg-gradient-to-r from-brand-red to-rose-300 bg-clip-text text-[10px] font-bold tracking-widest text-transparent uppercase">
            Garage Management
          </div>
        </div>
      </div>

      <div className="mx-5 h-px shrink-0 bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Main">
        {visibleItems.map((item) => {
          const isActive = item.href === activeHref;
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              onMouseEnter={() => warmRoute(item.href)}
              onFocus={() => warmRoute(item.href)}
              onTouchStart={() => warmRoute(item.href)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "group relative flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-sm font-medium text-white/65 outline-none transition-colors duration-150 hover:text-white focus-visible:ring-2 focus-visible:ring-brand-red/60",
                isActive && "text-white"
              )}
            >
              {isActive && (
                <motion.span
                  layoutId={`sidebar-active-pill-${variant}`}
                  transition={{ type: "spring", stiffness: 500, damping: 40, mass: 0.6 }}
                  className="absolute inset-0 rounded-xl bg-gradient-to-r from-brand-red to-brand-red-dark shadow-[0_4px_20px_-2px_rgba(225,29,72,0.5)]"
                />
              )}
              {isActive && (
                <span
                  aria-hidden
                  className="absolute top-1/2 -left-3 h-5 w-1 -translate-y-1/2 rounded-full bg-brand-red shadow-[0_0_10px_2px_rgba(225,29,72,0.55)]"
                />
              )}
              <span
                className={cn(
                  "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-lg border transition-colors duration-150",
                  isActive
                    ? "border-white/20 bg-white/15"
                    : "border-white/10 bg-white/5 group-hover:border-white/20 group-hover:bg-white/10"
                )}
              >
                <Icon className="size-4" />
              </span>
              <span className="relative z-10 truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mx-5 h-px shrink-0 bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      <div className="space-y-2.5 px-3 py-4">
        <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-3 backdrop-blur-md">
          <Avatar>
            <AvatarFallback className="bg-gradient-to-br from-brand-red to-brand-red-dark font-semibold text-white">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-semibold text-white">{displayName}</div>
            <div className="truncate text-[10px] font-bold tracking-widest text-white/45 uppercase">{roleLabel}</div>
          </div>
          <ChevronDown className="size-4 shrink-0 text-white/30" aria-hidden />
        </div>

        <motion.button
          type="button"
          onClick={handleSignOut}
          whileTap={{ scale: 0.98 }}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 text-sm font-medium text-white/70 outline-none transition-colors duration-150 hover:border-danger/40 hover:bg-danger/10 hover:text-danger focus-visible:ring-2 focus-visible:ring-danger/50"
        >
          <LogOut className="size-4" />
          Sign Out Session
        </motion.button>
      </div>
    </>
  );
}
