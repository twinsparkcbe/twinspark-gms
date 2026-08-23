"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { AttendanceEmployeeRow } from "@/services/attendance/types";

import { setAttendanceEmployeeActiveAction } from "@/app/(app)/attendance/actions";

import { ConfirmEmployeeStatusDialog } from "./confirm-employee-status-dialog";
import { EmployeeFormDialog } from "./employee-form-dialog";
import { EmployeesFilters } from "./employees-filters";
import { EmployeesTable } from "./employees-table";
import {
  DEFAULT_EMPLOYEE_FILTERS,
  filterEmployees,
  hasActiveEmployeeFilters,
  type EmployeeFilterState,
} from "./filter-employees";

/**
 * Employees tab — the attendance module's own staff roster.
 *
 * Filtering is client-side and there's no pagination: this is one garage's
 * staff list, the same reasoning as the Users screen. No delete action
 * exists anywhere on this screen by design (Rule 6) — deactivating is how an
 * employee leaves, so their history survives.
 */
export function EmployeesPageClient({ initialEmployees }: { initialEmployees: AttendanceEmployeeRow[] }) {
  const [employees, setEmployees] = useState(initialEmployees);
  const [filters, setFilters] = useState<EmployeeFilterState>(DEFAULT_EMPLOYEE_FILTERS);

  const visibleEmployees = useMemo(() => filterEmployees(employees, filters), [employees, filters]);
  const isFiltered = hasActiveEmployeeFilters(filters);
  const activeCount = employees.filter((employee) => employee.isActive).length;

  const [formDialog, setFormDialog] = useState<{ open: boolean; editing: AttendanceEmployeeRow | null }>({
    open: false,
    editing: null,
  });
  const [statusDialog, setStatusDialog] = useState<{ open: boolean; employee: AttendanceEmployeeRow | null }>({
    open: false,
    employee: null,
  });

  function upsertEmployee(employee: AttendanceEmployeeRow) {
    setEmployees((prev) =>
      prev.some((e) => e.id === employee.id)
        ? prev.map((e) => (e.id === employee.id ? employee : e))
        : [...prev, employee].sort((a, b) => a.name.localeCompare(b.name))
    );
  }

  async function handleToggleActive(employee: AttendanceEmployeeRow) {
    const result = await setAttendanceEmployeeActiveAction(employee.id, !employee.isActive);
    if (result.success) {
      upsertEmployee(result.data);
      toast.success(result.data.isActive ? "Employee activated." : "Employee deactivated.");
      return { success: true };
    }
    return { success: false, error: result.error };
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-neutral-900">Employees</h2>
          <p className="mt-0.5 text-sm text-neutral-500">
            {activeCount} active of {employees.length} total. Only active employees appear in Daily Attendance.
          </p>
        </div>
        <Button type="button" className="rounded-[10px]" onClick={() => setFormDialog({ open: true, editing: null })}>
          <Plus className="size-4" />
          Add Employee
        </Button>
      </div>

      <EmployeesFilters
        filters={filters}
        onChange={(next) => setFilters((prev) => ({ ...prev, ...next }))}
        onReset={() => setFilters(DEFAULT_EMPLOYEE_FILTERS)}
      />

      <div className="rounded-[14px] border border-neutral-200 bg-white p-4 shadow-sm">
        <EmployeesTable
          employees={visibleEmployees}
          isFiltered={isFiltered}
          onEdit={(employee) => setFormDialog({ open: true, editing: employee })}
          onToggleActive={(employee) => setStatusDialog({ open: true, employee })}
        />
      </div>

      <EmployeeFormDialog
        open={formDialog.open}
        editing={formDialog.editing}
        onOpenChange={(open) => setFormDialog((prev) => ({ ...prev, open }))}
        onSaved={upsertEmployee}
      />

      <ConfirmEmployeeStatusDialog
        open={statusDialog.open}
        employee={statusDialog.employee}
        nextActive={statusDialog.employee ? !statusDialog.employee.isActive : false}
        onOpenChange={(open) => setStatusDialog((prev) => ({ ...prev, open }))}
        onConfirm={handleToggleActive}
      />
    </div>
  );
}
