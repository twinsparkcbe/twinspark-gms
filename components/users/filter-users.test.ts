import { describe, expect, it } from "vitest";

import type { ProfileRow } from "@/services/users";

import { DEFAULT_USER_FILTERS, filterUsers, hasActiveUserFilters, type UserFilterState } from "./filter-users";

function makeUser(overrides: Partial<ProfileRow> & { id: string }): ProfileRow {
  return {
    fullName: "Ravi Kumar",
    email: "ravi@twinspark.in",
    role: "sales_person",
    isActive: true,
    createdAt: "2026-01-15T10:00:00.000Z",
    updatedAt: "2026-01-15T10:00:00.000Z",
    ...overrides,
  };
}

const USERS: ProfileRow[] = [
  makeUser({ id: "1", fullName: "Ravi Kumar", email: "ravi@twinspark.in", role: "admin", isActive: true }),
  makeUser({ id: "2", fullName: "Suresh Babu", email: "suresh@twinspark.in", role: "sales_person", isActive: true }),
  makeUser({ id: "3", fullName: "Meena R", email: "meena@garage.co.in", role: "sales_person", isActive: false }),
];

function withFilters(overrides: Partial<UserFilterState>): UserFilterState {
  return { ...DEFAULT_USER_FILTERS, ...overrides };
}

describe("filterUsers", () => {
  it("returns every user when no filter is applied", () => {
    expect(filterUsers(USERS, DEFAULT_USER_FILTERS)).toHaveLength(3);
  });

  it("matches search against the full name, case-insensitively", () => {
    const result = filterUsers(USERS, withFilters({ search: "suresh" }));
    expect(result.map((u) => u.id)).toEqual(["2"]);
  });

  it("matches search against the email", () => {
    const result = filterUsers(USERS, withFilters({ search: "garage.co.in" }));
    expect(result.map((u) => u.id)).toEqual(["3"]);
  });

  it("matches on a partial substring", () => {
    const result = filterUsers(USERS, withFilters({ search: "ee" }));
    expect(result.map((u) => u.id)).toEqual(["3"]);
  });

  it("ignores surrounding whitespace in the search term", () => {
    expect(filterUsers(USERS, withFilters({ search: "   " }))).toHaveLength(3);
    expect(filterUsers(USERS, withFilters({ search: "  ravi  " })).map((u) => u.id)).toEqual(["1"]);
  });

  it("returns an empty list when nothing matches the search", () => {
    expect(filterUsers(USERS, withFilters({ search: "zzz" }))).toEqual([]);
  });

  it("filters by a single role", () => {
    const result = filterUsers(USERS, withFilters({ roles: ["admin"] }));
    expect(result.map((u) => u.id)).toEqual(["1"]);
  });

  it("ORs multiple selected roles", () => {
    const result = filterUsers(USERS, withFilters({ roles: ["admin", "sales_person"] }));
    expect(result).toHaveLength(3);
  });

  it("filters by active status", () => {
    const result = filterUsers(USERS, withFilters({ statuses: ["active"] }));
    expect(result.map((u) => u.id)).toEqual(["1", "2"]);
  });

  it("filters by inactive status", () => {
    const result = filterUsers(USERS, withFilters({ statuses: ["inactive"] }));
    expect(result.map((u) => u.id)).toEqual(["3"]);
  });

  it("ANDs search, role, and status together", () => {
    const result = filterUsers(USERS, withFilters({ search: "twinspark", roles: ["sales_person"], statuses: ["active"] }));
    expect(result.map((u) => u.id)).toEqual(["2"]);
  });

  it("returns an empty list when facets conflict", () => {
    const result = filterUsers(USERS, withFilters({ roles: ["admin"], statuses: ["inactive"] }));
    expect(result).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const input = [...USERS];
    filterUsers(input, withFilters({ search: "ravi" }));
    expect(input).toHaveLength(3);
  });

  it("handles an empty roster", () => {
    expect(filterUsers([], withFilters({ search: "ravi" }))).toEqual([]);
  });
});

describe("hasActiveUserFilters", () => {
  it("is false for the defaults", () => {
    expect(hasActiveUserFilters(DEFAULT_USER_FILTERS)).toBe(false);
  });

  it("is false for a whitespace-only search", () => {
    expect(hasActiveUserFilters(withFilters({ search: "   " }))).toBe(false);
  });

  it("is true when a search term is set", () => {
    expect(hasActiveUserFilters(withFilters({ search: "ravi" }))).toBe(true);
  });

  it("is true when a role is selected", () => {
    expect(hasActiveUserFilters(withFilters({ roles: ["admin"] }))).toBe(true);
  });

  it("is true when a status is selected", () => {
    expect(hasActiveUserFilters(withFilters({ statuses: ["inactive"] }))).toBe(true);
  });
});

describe("filterUsers — Mechanic", () => {
  const WITH_MECHANIC: ProfileRow[] = [
    ...USERS,
    makeUser({ id: "4", fullName: "Anand M", email: "anand@twinspark.in", role: "mechanic", isActive: true }),
    makeUser({ id: "5", fullName: "Bala S", email: "bala@twinspark.in", role: "mechanic", isActive: false }),
  ];

  it("filters down to mechanics", () => {
    expect(filterUsers(WITH_MECHANIC, withFilters({ roles: ["mechanic"] })).map((u) => u.id)).toEqual(["4", "5"]);
  });

  it("ORs mechanics together with sales people, excluding admins", () => {
    const result = filterUsers(WITH_MECHANIC, withFilters({ roles: ["sales_person", "mechanic"] }));
    expect(result.map((u) => u.id)).toEqual(["2", "3", "4", "5"]);
  });

  it("treats an empty role list as all roles", () => {
    expect(filterUsers(WITH_MECHANIC, DEFAULT_USER_FILTERS)).toHaveLength(5);
  });

  it("ANDs role, status and search together", () => {
    const result = filterUsers(WITH_MECHANIC, withFilters({ roles: ["mechanic"], statuses: ["inactive"], search: "bala" }));
    expect(result.map((u) => u.id)).toEqual(["5"]);
  });
});
