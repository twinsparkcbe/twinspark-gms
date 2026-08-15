"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { User } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { CustomerRow } from "@/services/sales";
import { MOBILE_NUMBER_LENGTH, sanitizeMobileNumber } from "@/services/shared/mobile";

const MAX_SUGGESTIONS = 8;
const MIN_TERM_LENGTH = 2;

/**
 * Customer entry for a Sale — mobile number is the find-or-create key (scope
 * doc §2), but both Name and Mobile offer suggestions, since staff may recall
 * a returning customer either way. Picking a suggestion from either field
 * auto-fills all three. Typing a brand-new number just keeps whatever's typed
 * — record_sale() creates that customer on save. Deliberately not built on
 * the shared Combobox: this needs to accept free text across three fields at
 * once (name/mobile/address), not select-one-value-from-a-list.
 *
 * `customers` is the full list fetched once at page load
 * (listAllCustomersForPicker) — filtering happens entirely client-side here,
 * no network round trip per keystroke. Replaces an earlier debounced-search-
 * per-keystroke version that felt slow to type against.
 */
export function CustomerField({
  name,
  mobile,
  address,
  customers,
  onChangeName,
  onChangeMobile,
  onChangeAddress,
  disabled,
  errors,
}: {
  name: string;
  mobile: string;
  address: string;
  customers: CustomerRow[];
  onChangeName: (value: string) => void;
  onChangeMobile: (value: string) => void;
  onChangeAddress: (value: string) => void;
  disabled?: boolean;
  errors: { name?: string; mobile?: string };
}) {
  // Only one dropdown is ever open — whichever field the user is typing in.
  const [openField, setOpenField] = useState<"name" | "mobile" | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openField) return;
    function handlePointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenField(null);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [openField]);

  const nameSuggestions = useMemo(() => matchCustomersByName(customers, name), [customers, name]);
  const mobileSuggestions = useMemo(() => matchCustomersByMobile(customers, mobile), [customers, mobile]);

  function handleNameChange(value: string) {
    onChangeName(value);
    setOpenField(value.trim().length >= MIN_TERM_LENGTH ? "name" : null);
  }

  function handleMobileChange(rawValue: string) {
    // Digits only, hard-capped at 10 — the field can never hold a value that
    // would fail validation on submit.
    const value = sanitizeMobileNumber(rawValue);
    onChangeMobile(value);
    setOpenField(value.length >= MIN_TERM_LENGTH ? "mobile" : null);
  }

  function selectCustomer(customer: CustomerRow) {
    onChangeName(customer.name);
    onChangeMobile(customer.mobileNumber);
    onChangeAddress(customer.address ?? "");
    setOpenField(null);
  }

  return (
    <div ref={containerRef} className="grid gap-3 sm:grid-cols-2">
      <div className="relative space-y-1.5">
        <Label>Customer Name *</Label>
        <Input
          placeholder="e.g. Arun Kumar"
          value={name}
          disabled={disabled}
          autoComplete="off"
          aria-invalid={Boolean(errors.name) || undefined}
          onChange={(e) => handleNameChange(e.target.value)}
          onFocus={() => nameSuggestions.length > 0 && setOpenField("name")}
          onKeyDown={(e) => e.key === "Escape" && setOpenField(null)}
        />
        {errors.name && <p className="text-sm text-danger">{errors.name}</p>}

        <SuggestionList
          open={openField === "name"}
          suggestions={nameSuggestions}
          onSelect={selectCustomer}
        />
      </div>

      <div className="relative space-y-1.5">
        <Label>Mobile Number *</Label>
        <Input
          type="tel"
          inputMode="numeric"
          maxLength={MOBILE_NUMBER_LENGTH}
          placeholder="e.g. 9876543210"
          value={mobile}
          disabled={disabled}
          autoComplete="off"
          aria-invalid={Boolean(errors.mobile) || undefined}
          onChange={(e) => handleMobileChange(e.target.value)}
          onFocus={() => mobileSuggestions.length > 0 && setOpenField("mobile")}
          onKeyDown={(e) => e.key === "Escape" && setOpenField(null)}
        />
        {errors.mobile && <p className="text-sm text-danger">{errors.mobile}</p>}

        <SuggestionList
          open={openField === "mobile"}
          suggestions={mobileSuggestions}
          onSelect={selectCustomer}
        />
      </div>

      <div className={cn("space-y-1.5 sm:col-span-2")}>
        <Label>Address (optional)</Label>
        <Input
          placeholder="e.g. 12 Race Course Road, Coimbatore"
          value={address}
          disabled={disabled}
          onChange={(e) => onChangeAddress(e.target.value)}
        />
      </div>
    </div>
  );
}

/** The Name field still searches names — staff often only remember the name. */
function matchCustomersByName(customers: CustomerRow[], value: string): CustomerRow[] {
  const term = value.trim().toLowerCase();
  if (term.length < MIN_TERM_LENGTH) return [];
  return customers.filter((c) => c.name.toLowerCase().includes(term)).slice(0, MAX_SUGGESTIONS);
}

/** The Mobile field searches numbers only — it's digits-only now, so a name
 * match off it could never fire anyway. */
function matchCustomersByMobile(customers: CustomerRow[], value: string): CustomerRow[] {
  const term = value.trim();
  if (term.length < MIN_TERM_LENGTH) return [];
  return customers.filter((c) => c.mobileNumber.includes(term)).slice(0, MAX_SUGGESTIONS);
}

function SuggestionList({
  open,
  suggestions,
  onSelect,
}: {
  open: boolean;
  suggestions: CustomerRow[];
  onSelect: (customer: CustomerRow) => void;
}) {
  if (!open || suggestions.length === 0) return null;

  return (
    <div className="absolute top-full left-0 z-50 mt-1 w-full rounded-md border border-neutral-200 bg-white shadow-md">
      <div className="max-h-56 overflow-y-auto p-1">
        {suggestions.map((customer) => (
          <button
            key={customer.id}
            type="button"
            onClick={() => onSelect(customer)}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-neutral-100"
          >
            <User className="size-4 shrink-0 text-neutral-400" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-neutral-900">{customer.name}</span>
              <span className="block truncate text-xs text-neutral-500">{customer.mobileNumber}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
