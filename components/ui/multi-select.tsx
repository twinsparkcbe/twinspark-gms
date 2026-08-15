"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type MultiSelectOption = {
  value: string;
  label: string;
};

/**
 * Searchable, multi-select dropdown: a trigger button that opens a popover
 * with a search box and a checkbox list. Selecting toggles values; the
 * caller owns the selected array (match-ANY semantics are up to the query).
 * The trigger summarises the selection ("All", a single label, or "N
 * selected"). Used by the inventory Type/Brand filters.
 */
export function MultiSelect({
  options,
  values,
  onChange,
  placeholder = "All",
  searchPlaceholder = "Search...",
  emptyText = "No results found.",
  className,
}: {
  options: MultiSelectOption[];
  values: string[];
  onChange: (values: string[]) => void;
  /** Shown on the trigger when nothing is selected. */
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filteredOptions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return options;
    return options.filter((o) => o.label.toLowerCase().includes(query));
  }, [options, search]);

  function toggle(value: string) {
    if (values.includes(value)) {
      onChange(values.filter((v) => v !== value));
    } else {
      onChange([...values, value]);
    }
  }

  // Trigger label: placeholder when empty, the single label when exactly one
  // is picked, otherwise a count so the button doesn't overflow.
  const triggerLabel =
    values.length === 0
      ? placeholder
      : values.length === 1
        ? options.find((o) => o.value === values[0])?.label ?? placeholder
        : `${values.length} selected`;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={triggerLabel}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-[10px] border border-neutral-200 bg-white px-3.5 text-sm whitespace-nowrap text-neutral-900 shadow-xs outline-none focus-visible:border-brand-red focus-visible:ring-[3px] focus-visible:ring-brand-red/20 disabled:cursor-not-allowed disabled:opacity-50",
            values.length === 0 && "text-neutral-400",
            className
          )}
        >
          <span className="min-w-0 truncate">{triggerLabel}</span>
          <ChevronsUpDown className="size-4 shrink-0 text-neutral-400" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <div className="border-b border-neutral-200 p-2">
          <Input
            autoFocus
            className="h-9"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="max-h-56 overflow-y-auto p-1">
          {filteredOptions.length === 0 && (
            <p className="px-2 py-3 text-center text-sm text-neutral-500">{emptyText}</p>
          )}
          {filteredOptions.map((option) => {
            const checked = values.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => toggle(option.value)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-neutral-100"
              >
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-[4px] border",
                    checked ? "border-brand-red bg-brand-red text-white" : "border-neutral-300"
                  )}
                >
                  {checked && <Check className="size-3" />}
                </span>
                <span className="min-w-0 truncate">{option.label}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
