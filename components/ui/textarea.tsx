import * as React from "react";

import { cn } from "@/lib/utils";

// Mirrors Input's tokens exactly (twinspark-style-guide.md §7) so multi-line
// fields never drift into a one-off style.
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-20 w-full rounded-md border border-input bg-white px-3.5 py-2.5 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-neutral-400 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-brand-red focus-visible:ring-[3px] focus-visible:ring-brand-red/20",
        "aria-invalid:border-danger aria-invalid:ring-danger/20",
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
