import { describe, expect, it } from "vitest";

import { USER_ROLES } from "@/services/users/schemas";

import { ROLE_BADGE_VARIANTS, ROLE_LABELS } from "./role-labels";

describe("role labels", () => {
  it("labels the Mechanic role", () => {
    expect(ROLE_LABELS.mechanic).toBe("Mechanic");
  });

  it("gives Mechanic its own badge variant, distinct from Admin", () => {
    expect(ROLE_BADGE_VARIANTS.mechanic).not.toBe(ROLE_BADGE_VARIANTS.admin);
    expect(ROLE_BADGE_VARIANTS.admin).toBe("info");
  });

  // A role added to the enum but not here would render a blank badge.
  it("has a label and a variant for every role the app can store", () => {
    for (const role of USER_ROLES) {
      expect(ROLE_LABELS[role]).toBeTruthy();
      expect(ROLE_BADGE_VARIANTS[role]).toBeTruthy();
    }
  });
});
