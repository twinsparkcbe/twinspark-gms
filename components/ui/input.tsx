import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-11 w-full min-w-0 rounded-md border border-input bg-white px-3.5 py-2.5 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-neutral-400 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-brand-red focus-visible:ring-[3px] focus-visible:ring-brand-red/20",
        "aria-invalid:border-danger aria-invalid:ring-danger/20",
        className
      )}
      {...props}
    />
  );
}

export { Input };
