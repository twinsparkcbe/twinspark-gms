"use client";

import Link from "next/link";
import { FileBarChart, Pencil, Power, PowerOff, Users as UsersIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AttendanceEmployeeRow } from "@/services/attendance/types";

import { AttendanceRoleBadge } from "./attendance-badges";

// Employee ID | Name | Role | Mobile | Joining Date | Status | Actions
const ROW_GRID_CLASS =
  "grid grid-cols-[100px_minmax(140px,1fr)_140px_120px_115px_105px_95px_125px] gap-3";

export function EmployeesTable({
  employees,
  isFiltered,
  onEdit,
  onToggleActive,
}: {
  employees: AttendanceEmployeeRow[];
  isFiltered: boolean;
  onEdit: (employee: AttendanceEmployeeRow) => void;
  onToggleActive: (employee: AttendanceEmployeeRow) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <div role="table" aria-label="Attendance employees" className="min-w-[1040px]">
        <div
          role="row"
          className={cn(ROW_GRID_CLASS, "px-4 py-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase")}
        >
          <span>Employee ID</span>
          <span>Name</span>
          <span>Role</span>
          <span>Mobile</span>
          <span className="text-right">Salary / Day</span>
          <span>Joined</span>
          <span>Status</span>
          <span className="text-right">Actions</span>
        </div>

        <div className="flex flex-col gap-2">
          {employees.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <UsersIcon className="size-10 text-neutral-300" />
              <p className="text-sm font-medium text-neutral-700">
                {isFiltered ? "No employees match these filters" : "No employees yet"}
              </p>
              <p className="text-sm text-neutral-500">
                {isFiltered
                  ? "Try a different search term, role, or status."
                  : "Add your staff here first — Daily Attendance lists every active employee."}
              </p>
            </div>
          )}

          {employees.map((employee) => (
            <div
              key={employee.id}
              role="row"
              className={cn(
                ROW_GRID_CLASS,
                "items-center rounded-[10px] border border-neutral-200 bg-white px-4 py-3 shadow-sm transition-colors hover:bg-neutral-50",
                !employee.isActive && "opacity-70"
              )}
            >
              <div role="cell" aria-label="Employee ID" className="min-w-0 truncate font-mono text-[13px] font-bold text-neutral-500">
                {employee.employeeCode}
              </div>

              <div role="cell" aria-label="Name" className="min-w-0 truncate font-semibold text-neutral-900" title={employee.name}>
                {employee.name}
              </div>

              <div role="cell" aria-label="Role" className="min-w-0">
                <AttendanceRoleBadge role={employee.role} otherRoleDescription={employee.otherRoleDescription} />
              </div>

              <div role="cell" aria-label="Mobile" className="min-w-0 truncate font-mono text-[13px] text-neutral-600">
                {employee.mobile ?? "—"}
              </div>

              {/* A dash, never Rs 0 — "no rate recorded" is not "earns nothing". */}
              <div role="cell" aria-label="Salary per day" className="min-w-0 text-right text-sm">
                {employee.dailyWage != null ? (
                  <span className="font-mono font-semibold text-neutral-900">{formatINR(employee.dailyWage)}</span>
                ) : (
                  <span className="text-neutral-300">&mdash;</span>
                )}
              </div>

              <div role="cell" aria-label="Joining date" className="min-w-0 text-sm text-neutral-500">
                {formatDate(`${employee.joiningDate}T00:00:00Z`)}
              </div>

              <div role="cell" aria-label="Status" className="min-w-0">
                <Badge variant={employee.isActive ? "success" : "neutral"}>
                  {employee.isActive ? "Active" : "Inactive"}
                </Badge>
              </div>

              <div role="cell" aria-label="Actions" className="flex justify-end gap-1">
                <Button
                  asChild
                  variant="ghost"
                  size="icon"
                  aria-label={`Attendance report for ${employee.name}`}
                  title="Attendance report"
                  className="size-9 rounded-[10px] text-neutral-500 hover:text-neutral-900"
                >
                  <Link href={`/attendance/employees/${employee.id}`}>
                    <FileBarChart className="size-4" />
                  </Link>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Edit ${employee.name}`}
                  title="Edit"
                  className="size-9 rounded-[10px] text-neutral-500 hover:text-neutral-900"
                  onClick={() => onEdit(employee)}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={employee.isActive ? `Deactivate ${employee.name}` : `Activate ${employee.name}`}
                  title={employee.isActive ? "Deactivate" : "Activate"}
                  className={cn("size-9 rounded-[10px]", employee.isActive ? "text-danger hover:text-danger" : "text-success hover:text-success")}
                  onClick={() => onToggleActive(employee)}
                >
                  {employee.isActive ? <PowerOff className="size-4" /> : <Power className="size-4" />}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
