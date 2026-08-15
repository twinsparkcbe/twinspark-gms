import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

// Pill badges — light-shade bg + solid text per style guide §12 (approved
// POC system). success/info/channel double as payment-channel indicators
// (cash/UPI/card); warning is solid (used for alerts, not a soft tint).
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 rounded-full border border-transparent px-2.5 py-0.5 text-xs font-medium whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        success: "bg-success-bg text-success",
        warning: "bg-warning text-white",
        danger: "bg-danger-bg text-danger",
        info: "bg-info-bg text-info",
        channel: "bg-channel-purple-bg text-channel-purple",
        neutral: "bg-neutral-100 text-neutral-600",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  }
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";

  return <Comp data-slot="badge" data-variant={variant} className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
