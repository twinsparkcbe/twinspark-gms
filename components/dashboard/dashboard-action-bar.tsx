import Link from "next/link";
import { Globe, Receipt, ShoppingCart, Wrench } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Replaces the old right-rail Quick Actions list. Those were low-contrast text
 * links parked beside the chart, so the single most common daily task —
 * billing a walk-in customer — was the least visible thing on the page.
 *
 * New Sale is the one brand-filled action here; per the style guide exactly
 * one primary sits on a view, and everything else is an outline button. Order
 * is by daily frequency, not by module order in the sidebar.
 */
const ACTIONS = [
  { href: "/sales/new", label: "New sale", icon: Receipt, primary: true },
  { href: "/service/new", label: "New service", icon: Wrench, primary: false },
  { href: "/purchases?action=new", label: "New purchase", icon: ShoppingCart, primary: false },
  { href: "/online-orders", label: "Online orders", icon: Globe, primary: false, badgeKey: "ordersToDispatch" },
] as const;

export function DashboardActionBar({ ordersToDispatch = 0 }: { ordersToDispatch?: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {ACTIONS.map((action) => (
        <Link
          key={action.href}
          href={action.href}
          className={cn(
            "inline-flex items-center gap-2 rounded-[10px] px-4 py-2.5 text-sm font-semibold transition-colors",
            action.primary
              ? "bg-brand-red text-white hover:bg-brand-red-dark"
              : "border border-neutral-200 bg-white text-neutral-700 shadow-sm hover:bg-neutral-50 hover:text-neutral-900"
          )}
        >
          <action.icon className="size-4 shrink-0" aria-hidden="true" />
          {action.label}
          {/* Hidden entirely at zero rather than showing a "0" chip — an empty
              queue shouldn't decorate the button with a dead badge. */}
          {"badgeKey" in action && ordersToDispatch > 0 && (
            <span className="ml-0.5 inline-flex min-w-5 items-center justify-center rounded-full bg-brand-red px-1.5 py-0.5 text-xs font-bold leading-none text-white">
              {ordersToDispatch.toLocaleString("en-IN")}
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}
