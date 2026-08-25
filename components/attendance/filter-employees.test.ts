import { describe, expect, it } from "vitest";

import type { AttendanceEmployeeRow } from "@/services/attendance/types";

import { DEFAULT_EMPLOYEE_FILTERS, filterEmployees, hasActiveEmployeeFilters } from "./filter-employees";

function employee(overrides: Partial<AttendanceEmployeeRow> = {}): AttendanceEmployeeRow {
  return {
    id: "emp-1",
    employeeCode: "EMP01",
    name: "Arun",
    role: "SALES_PERSON",
    otherRoleDescription: null,
    dailyWage: 600,
    mobile: "9876543210",
    joiningDate: "2026-01-01",
    isActive: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const ROSTER = [
  employee({ id: "1", employeeCode: "001", name: "Arun", role: "SALES_PERSON" }),
  employee({ id: "2", employeeCode: "002", name: "Kumar", role: "SERVICE_PERSON" }),
  employee({ id: "3", employeeCode: "003", name: "Rahul", role: "SERVICE_PERSON", isActive: false }),
  employee({ id: "4", employeeCode: "004", name: "Suresh", role: "OTHER_STAFF", otherRoleDescription: "Watchman", mobile: null }),
];

describe("filterEmployees", () => {
  it("returns everything when no filter is set", () => {
    expect(filterEmployees(ROSTER, DEFAULT_EMPLOYEE_FILTERS)).toHaveLength(4);
  });

  it("searches name, employee code and mobile", () => {
    expect(filterEmployees(ROSTER, { ...DEFAULT_EMPLOYEE_FILTERS, search: "kum" }).map((e) => e.name)).toEqual(["Kumar"]);
    expect(filterEmployees(ROSTER, { ...DEFAULT_EMPLOYEE_FILTERS, search: "003" }).map((e) => e.name)).toEqual(["Rahul"]);
    expect(filterEmployees(ROSTER, { ...DEFAULT_EMPLOYEE_FILTERS, search: "98765" })).toHaveLength(3);
  });

  /** "Other Staff" is a bucket — searching for the actual job has to work. */
  it("finds an Other Staff member by what they actually do", () => {
    expect(filterEmployees(ROSTER, { ...DEFAULT_EMPLOYEE_FILTERS, search: "watchman" }).map((e) => e.name)).toEqual(["Suresh"]);
    expect(filterEmployees(ROSTER, { ...DEFAULT_EMPLOYEE_FILTERS, search: "WATCH" }).map((e) => e.name)).toEqual(["Suresh"]);
  });

  it("is case-insensitive and tolerates an employee with no mobile", () => {
    expect(filterEmployees(ROSTER, { ...DEFAULT_EMPLOYEE_FILTERS, search: "SURESH" }).map((e) => e.name)).toEqual(["Suresh"]);
  });

  it("ORs within the role facet", () => {
    const result = filterEmployees(ROSTER, { ...DEFAULT_EMPLOYEE_FILTERS, roles: ["SERVICE_PERSON", "OTHER_STAFF"] });
    expect(result.map((e) => e.name)).toEqual(["Kumar", "Rahul", "Suresh"]);
  });

  it("filters by active status", () => {
    expect(filterEmployees(ROSTER, { ...DEFAULT_EMPLOYEE_FILTERS, statuses: ["inactive"] }).map((e) => e.name)).toEqual(["Rahul"]);
    expect(filterEmployees(ROSTER, { ...DEFAULT_EMPLOYEE_FILTERS, statuses: ["active"] })).toHaveLength(3);
  });

  it("ANDs across facets", () => {
    const result = filterEmployees(ROSTER, {
      search: "",
      roles: ["SERVICE_PERSON"],
      statuses: ["active"],
    });
    expect(result.map((e) => e.name)).toEqual(["Kumar"]);
  });
});

describe("hasActiveEmployeeFilters", () => {
  it("ignores whitespace-only searches", () => {
    expect(hasActiveEmployeeFilters(DEFAULT_EMPLOYEE_FILTERS)).toBe(false);
    expect(hasActiveEmployeeFilters({ ...DEFAULT_EMPLOYEE_FILTERS, search: "   " })).toBe(false);
    expect(hasActiveEmployeeFilters({ ...DEFAULT_EMPLOYEE_FILTERS, search: "a" })).toBe(true);
    expect(hasActiveEmployeeFilters({ ...DEFAULT_EMPLOYEE_FILTERS, roles: ["SALES_PERSON"] })).toBe(true);
  });
});
