import type { AttendanceEmployeeRow } from "@/services/attendance/types";
import type { AttendanceRole } from "@/types/database.types";

export interface EmployeeFilterState {
  search: string;
  roles: AttendanceRole[];
  statuses: ("active" | "inactive")[];
}

export const DEFAULT_EMPLOYEE_FILTERS: EmployeeFilterState = {
  search: "",
  roles: [],
  statuses: [],
};

export function hasActiveEmployeeFilters(filters: EmployeeFilterState): boolean {
  return filters.search.trim() !== "" || filters.roles.length > 0 || filters.statuses.length > 0;
}

/**
 * Client-side filtering, same reasoning as components/users/filter-users.ts:
 * this is one garage's staff roster loaded in full, so there's nothing to
 * gain from a server round trip per keystroke.
 *
 * Empty multi-selects mean "all" rather than "none"; values within a facet
 * are OR'd and the facets are AND'd — matching every other filter in the app.
 */
export function filterEmployees(
  employees: AttendanceEmployeeRow[],
  filters: EmployeeFilterState
): AttendanceEmployeeRow[] {
  const search = filters.search.trim().toLowerCase();

  return employees.filter((employee) => {
    if (
      search &&
      !employee.name.toLowerCase().includes(search) &&
      !employee.employeeCode.toLowerCase().includes(search) &&
      // Searching "watchman" should find the person hired as one, even
      // though their role enum just says OTHER_STAFF.
      !(employee.otherRoleDescription ?? "").toLowerCase().includes(search) &&
      !(employee.mobile ?? "").includes(search)
    ) {
      return false;
    }
    if (filters.roles.length > 0 && !filters.roles.includes(employee.role)) return false;
    if (filters.statuses.length > 0 && !filters.statuses.includes(employee.isActive ? "active" : "inactive")) {
      return false;
    }
    return true;
  });
}
