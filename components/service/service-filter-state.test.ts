import { describe, expect, it } from "vitest";

import { buildDefaultServiceFilters } from "./service-filter-state";

const MECHANIC = { id: "mech-1", role: "mechanic" as const };
const ADMIN = { id: "admin-1", role: "admin" as const };

describe("buildDefaultServiceFilters", () => {
  it("defaults a Mechanic to their own jobs", () => {
    expect(buildDefaultServiceFilters(MECHANIC).assignedMechanicId).toBe("mech-1");
  });

  it("leaves an Admin unfiltered", () => {
    expect(buildDefaultServiceFilters(ADMIN).assignedMechanicId).toBe("");
  });

  it("leaves every other facet empty for both roles", () => {
    for (const user of [MECHANIC, ADMIN]) {
      const filters = buildDefaultServiceFilters(user);
      expect(filters.search).toBe("");
      expect(filters.status).toBe("");
      expect(filters.dateFrom).toBe("");
      expect(filters.dateTo).toBe("");
    }
  });

  // Reset uses the same builder, so a Mechanic returns to "My jobs" rather
  // than to an all-jobs view they never started from.
  it("is stable across repeated calls, so reset lands back on My jobs", () => {
    expect(buildDefaultServiceFilters(MECHANIC)).toEqual(buildDefaultServiceFilters(MECHANIC));
  });
});
