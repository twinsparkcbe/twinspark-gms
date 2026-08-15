"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { MechanicOption } from "@/services/users";

/** Sentinel for the "nobody assigned yet" option — Radix Select can't take
 * an empty-string item value, and the form/filter both need to express it. */
export const UNASSIGNED_VALUE = "UNASSIGNED";

/**
 * One assignment control, shared by the Service Job form (which writes
 * assignedMechanicId) and the Service list filter (which also offers
 * "Unassigned" as a thing to filter *by*). Kept in one place so the two
 * never drift into differently-worded options.
 */
export function MechanicSelect({
  value,
  onChange,
  mechanics,
  disabled,
  placeholder = "Unassigned",
  allOption,
  className = "w-full rounded-[10px]",
}: {
  /** "" = nothing chosen, UNASSIGNED_VALUE = explicitly unassigned. */
  value: string;
  onChange: (value: string) => void;
  mechanics: MechanicOption[];
  disabled?: boolean;
  placeholder?: string;
  /** Label for an "everything" entry — filter mode only. */
  allOption?: string;
  className?: string;
}) {
  return (
    <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger size="sm" className={className}>
        <SelectValue placeholder={allOption ?? placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allOption && <SelectItem value="ALL">{allOption}</SelectItem>}
        <SelectItem value={UNASSIGNED_VALUE}>{allOption ? "Unassigned" : "Unassigned"}</SelectItem>
        {mechanics.map((mechanic) => (
          <SelectItem key={mechanic.id} value={mechanic.id}>
            {mechanic.fullName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
