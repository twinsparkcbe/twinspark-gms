import { describe, expect, it } from "vitest";

import { getLandingModule, getLandingPath, isValidLandingFor } from "./landing-path";
import { canAccessModule, type UserRole } from "./permissions";

const ROLES: UserRole[] = ["admin", "sales_person", "mechanic"];

describe("getLandingPath", () => {
  it("sends an Admin to the Dashboard", () => {
    expect(getLandingPath("admin")).toBe("/dashboard");
  });

  it("sends a Sales Person to Sales", () => {
    expect(getLandingPath("sales_person")).toBe("/sales");
  });

  it("sends a Mechanic to Service", () => {
    expect(getLandingPath("mechanic")).toBe("/service");
  });
});

describe("landing target is always reachable", () => {
  // The original bug this guards against: everyone landed on /dashboard,
  // which requireAdmin() bounces — an infinite redirect for a Sales Person.
  it.each(ROLES)("gives %s a landing module they can access", (role) => {
    expect(canAccessModule(role, getLandingModule(role))).toBe(true);
    expect(isValidLandingFor(role)).toBe(true);
  });
});
