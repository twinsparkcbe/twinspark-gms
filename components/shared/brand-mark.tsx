import Image from "next/image";

import { cn } from "@/lib/utils";

/**
 * Twinspark logo (public/twinspark-logo.jpg).
 *
 * - "sidebar": small, wrapped in a white chip — needed for contrast against
 *   the dark slate-950 sidebar, since the source .jpg has a flat white
 *   background (no alpha channel).
 * - "login": large, rendered directly on the page (its white background
 *   blends into the near-white neutral-50 page bg), with a warm red/gold
 *   glow behind it per the approved reference.
 * - "invoice": plain, no chip/no glow — sits directly on the invoice's
 *   white paper background next to the business name (sales-invoice-view.tsx).
 */
export function BrandMark({
  variant = "sidebar",
  className,
}: {
  variant?: "sidebar" | "login" | "invoice";
  className?: string;
}) {
  if (variant === "invoice") {
    return (
      <Image
        src="/twinspark-logo.jpg"
        alt="Twinspark"
        width={64}
        height={64}
        className={cn("shrink-0 rounded-md object-contain", className)}
        // Invoice pages auto-print on mount (AutoPrintInvoice) — without
        // priority this lazy-loads and can lose the race, producing a print
        // preview with the logo missing/blank. AutoPrintInvoice also waits
        // for images itself; this just gets the fetch started sooner.
        priority
      />
    );
  }

  if (variant === "login") {
    return (
      <div className={cn("relative inline-flex items-center justify-center", className)}>
        <div
          aria-hidden
          className="absolute inset-0 -z-10 rounded-full blur-2xl"
          style={{
            background:
              "radial-gradient(circle, rgba(225,29,72,0.45) 0%, rgba(228,179,67,0.25) 45%, transparent 72%)",
            transform: "scale(1.8)",
          }}
        />
        <Image
          src="/twinspark-logo.jpg"
          alt="Twinspark"
          width={140}
          height={140}
          className="rounded-2xl object-contain"
          priority
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white ring-1 ring-neutral-200",
        className
      )}
    >
      <Image src="/twinspark-logo.jpg" alt="Twinspark" width={36} height={36} className="object-contain" priority />
    </div>
  );
}
