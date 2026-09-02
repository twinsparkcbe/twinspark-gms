import { describe, expect, it } from "vitest";

import type { ProfileRow } from "@/services/users";

import { DEFAULT_NEW_USER_ROLE, initialUserFormState } from "./user-form-state";

const ANBU: ProfileRow = {
  id: "u-anbu",
  email: "twinsparkservice@gmail.com",
  fullName: "ANBU",
  role: "mechanic",
  isActive: true,
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
};

const MANI: ProfileRow = { ...ANBU, id: "u-mani", email: "mani@twinspark.in", fullName: "MANI", role: "admin" };

describe("initialUserFormState", () => {
  it("seeds every field from the user being edited", () => {
    expect(initialUserFormState(ANBU)).toEqual({
      fullName: "ANBU",
      email: "twinsparkservice@gmail.com",
      password: "",
      role: "mechanic",
    });
  });

  it("gives Add User an entirely blank form", () => {
    expect(initialUserFormState(null)).toEqual({
      fullName: "",
      email: "",
      password: "",
      role: DEFAULT_NEW_USER_ROLE,
    });
  });

  it("new accounts default to the least-privileged role, never admin", () => {
    expect(DEFAULT_NEW_USER_ROLE).toBe("sales_person");
    expect(initialUserFormState(null).role).not.toBe("admin");
  });

  // The reported bug: open MANI (admin), close, open ANBU (mechanic) and the
  // dialog still showed Administrator. Seeding is a pure function of whoever
  // is being edited right now, so it cannot carry anything over.
  it("depends only on the user passed in — no state from the one before", () => {
    expect(initialUserFormState(MANI).role).toBe("admin");
    expect(initialUserFormState(ANBU).role).toBe("mechanic");
    expect(initialUserFormState(null).email).toBe("");
  });

  it("never carries a password across, in either direction", () => {
    expect(initialUserFormState(ANBU).password).toBe("");
    expect(initialUserFormState(null).password).toBe("");
  });
});
