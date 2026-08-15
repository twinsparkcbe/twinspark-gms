"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, Plus } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type ComboboxOption = {
  value: string;
  label: string;
};

/**
 * A single-input searchable combobox: one text field that doubles as the
 * search box, with matching options dropping down directly beneath it. When
 * `onCreate` is provided and the typed text matches no existing option, an
 * inline "Create ..." action appears so callers can add new options without
 * leaving the field (see BrandCombobox for a concrete usage).
 *
 * The dropdown panel is rendered inline — absolutely positioned inside a
 * relatively positioned wrapper — rather than through a Radix Popover
 * portal. Every caller of this component lives inside a Dialog, and
 * portalling the panel out to document.body put it outside the Dialog's own
 * DOM subtree; Radix's outside-pointer detection on the Dialog could then
 * misclassify a click on the panel (e.g. "+ Add") as an outside interaction
 * and swallow it before the button's onClick ever fired (reported: "+ Add"
 * appears to do nothing). Rendering inline avoids that class of nested
 * Dialog+Popover portal bugs entirely.
 */
export function Combobox({
  options,
  value,
  onChange,
  onCreate,
  placeholder = "Search...",
  emptyText = "No results found.",
  createLabel = (query) => `Create "${query}"`,
  disabled,
  hasError,
  className,
}: {
  options: ComboboxOption[];
  value: string | null;
  onChange: (value: string) => void;
  /** When supplied, enables inline creation of a new option from the query. */
  onCreate?: (query: string) => Promise<{ success: boolean; value?: string }>;
  placeholder?: string;
  emptyText?: string;
  createLabel?: (query: string) => string;
  disabled?: boolean;
  hasError?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // Remembers the label typed for a just-created option. Some callers (e.g.
  // "Specify Type") accept whatever the user types as its own value/label
  // pair without ever persisting it back into the `options` prop, so
  // `options.find` below would never locate it and the field would render
  // blank right after a successful create — this fallback fixes that without
  // requiring every caller to track its own created options.
  const [createdOption, setCreatedOption] = useState<ComboboxOption | null>(null);

  // Manual outside-click handling (replacing Radix Popover's) — closes the
  // panel when a pointer goes down anywhere outside this component.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const selectedOption =
    options.find((o) => o.value === value) ?? (createdOption?.value === value ? createdOption : null);

  const filteredOptions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return options;
    return options.filter((o) => o.label.toLowerCase().includes(query));
  }, [options, search]);

  const trimmedSearch = search.trim();
  const hasExactMatch = options.some((o) => o.label.toLowerCase() === trimmedSearch.toLowerCase());
  const canCreate = Boolean(onCreate) && trimmedSearch.length > 0 && !hasExactMatch;

  function handleSelect(nextValue: string) {
    onChange(nextValue);
    setSearch("");
    setOpen(false);
  }

  async function handleCreate() {
    if (!canCreate || !onCreate) return;
    setIsCreating(true);
    const result = await onCreate(trimmedSearch);
    setIsCreating(false);

    if (result.success && result.value) {
      setCreatedOption({ value: result.value, label: trimmedSearch });
      onChange(result.value);
      setSearch("");
      setOpen(false);
    }
  }

  // The single input shows either what the user is typing (search) or the
  // currently selected option label when the dropdown is closed and idle.
  const inputValue = open ? search : (selectedOption?.label ?? search);

  return (
    <div ref={containerRef} className="relative">
      <Input
        disabled={disabled}
        placeholder={placeholder}
        value={inputValue}
        aria-invalid={hasError || undefined}
        className={className}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (filteredOptions.length === 1) {
              handleSelect(filteredOptions[0].value);
            } else if (canCreate) {
              void handleCreate();
            }
          } else if (e.key === "Escape" && open) {
            e.preventDefault();
            // Stop the parent Dialog from also treating this Escape as its
            // own close request — just collapse the dropdown first.
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 w-full rounded-md border border-neutral-200 bg-white shadow-md">
          <div className="max-h-56 overflow-y-auto p-1">
            {filteredOptions.length === 0 && !canCreate && (
              <p className="px-2 py-3 text-center text-sm text-neutral-500">{emptyText}</p>
            )}
            {filteredOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleSelect(option.value)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-neutral-100"
              >
                <Check className={cn("size-4 shrink-0", option.value === value ? "opacity-100" : "opacity-0")} />
                {option.label}
              </button>
            ))}
            {canCreate && (
              <button
                type="button"
                onClick={handleCreate}
                disabled={isCreating}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm font-medium text-brand-red hover:bg-brand-red/5 disabled:opacity-60"
              >
                {isCreating ? (
                  <Loader2 className="size-4 shrink-0 animate-spin" />
                ) : (
                  <Plus className="size-4 shrink-0" />
                )}
                {createLabel(trimmedSearch)}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
