"use client";

import { RotateCcw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import { ATTENDANCE_ROLE_LABELS, ATTENDANCE_ROLES } from "@/services/attendance/schemas";
import type { AttendanceRole } from "@/types/database.types";

import type { EmployeeFilterState } from "./filter-employees";

const ROLE_OPTIONS = ATTENDANCE_ROLES.map((value) => ({ value, label: ATTENDANCE_ROLE_LABELS[value] }));

const STATUS_OPTIONS: { value: "active" | "inactive"; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

export function EmployeesFilters({
  filters,
  onChange,
  onReset,
}: {
  filters: EmployeeFilterState;
  onChange: (next: Partial<EmployeeFilterState>) => void;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-neutral-200 bg-white p-3 shadow-sm sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative min-w-0 flex-1 sm:min-w-[220px]">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-neutral-400" />
        <Input
          placeholder="Search by name, employee ID, or mobile..."
          className="h-9 rounded-[10px] pl-9 text-sm"
          value={filters.search}
          onChange={(e) => onChange({ search: e.target.value })}
        />
      </div>

      <div className="w-full sm:w-[180px]">
        <MultiSelect
          options={ROLE_OPTIONS}
          values={filters.roles}
          onChange={(values) => onChange({ roles: values as AttendanceRole[] })}
          placeholder="All Roles"
          searchPlaceholder="Search roles..."
          emptyText="No matching role."
        />
      </div>

      <div className="w-full sm:w-[150px]">
        <MultiSelect
          options={STATUS_OPTIONS}
          values={filters.statuses}
          onChange={(values) => onChange({ statuses: values as ("active" | "inactive")[] })}
          placeholder="All Statuses"
          searchPlaceholder="Search statuses..."
          emptyText="No matching status."
        />
      </div>

      <div className="flex shrink-0 gap-2">
        <Button variant="secondary" size="sm" className="rounded-[10px]" onClick={onReset}>
          <RotateCcw className="size-4" />
          Reset
        </Button>
      </div>
    </div>
  );
}
