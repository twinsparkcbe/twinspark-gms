import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

// Variants follow twinspark-style-guide.md §7 (Components > Buttons) exactly.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-extrabold whitespace-nowrap transition-colors outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary: "bg-brand-red text-white shadow-xs hover:bg-brand-red-dark",
        secondary:
          "border border-neutral-200 bg-white text-neutral-900 hover:bg-neutral-100",
        danger: "bg-danger text-white shadow-xs hover:bg-danger/90",
        ghost: "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900",
        link: "text-brand-red underline-offset-4 hover:underline",
      },
      size: {
        // Heights follow twinspark-style-guide.md §12 touch-target rhythm
        // (py-2/px-3 up to py-3/px-4, comfortably over 44px on mobile).
        default: "h-11 px-4 py-2.5 has-[>svg]:px-3.5",
        sm: "h-9 gap-1.5 rounded-md px-3 py-2 text-sm has-[>svg]:px-2.5",
        lg: "h-12 rounded-md px-6 py-3 text-base has-[>svg]:px-5",
        icon: "size-11",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
