"use client";

import { useState } from "react";
import { Menu } from "lucide-react";

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

import { SidebarNav, type SidebarProps } from "./sidebar";

/**
 * The sidebar as a slide-in drawer, for viewports below `lg` where the 264px
 * rail would eat most of the screen.
 *
 * Renders the same SidebarNav as the desktop rail rather than a trimmed-down
 * copy — a second nav list would drift the moment anyone adds a module.
 */
export function MobileSidebar(props: SidebarProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation menu"
        className="-ml-1 flex size-9 shrink-0 items-center justify-center rounded-[10px] text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:outline-hidden lg:hidden"
      >
        <Menu className="size-5" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          // The nav supplies its own branded header, and the panel is dark, so
          // the default light close button would be invisible against it.
          showCloseButton={false}
          className="w-[280px] border-r-0 bg-gradient-to-b from-brand-black to-brand-black-soft text-white sm:max-w-[280px]"
        >
          {/* Radix requires a title on Dialog content for screen readers; it's
              visually hidden because the branded header already names the app. */}
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          {/* onNavigate closes the drawer on tap — a client-side route change
              doesn't unmount the Sheet, so it would otherwise stay open over
              the page the user just navigated to. */}
          <SidebarNav {...props} variant="mobile" onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}
