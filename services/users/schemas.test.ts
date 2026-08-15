import { describe, expect, it } from "vitest";

import { createUserInputSchema, resetPasswordInputSchema, updateUserInputSchema, USER_ROLES } from "./schemas";

// USR-012: create-user validation rejects bad input before any Supabase call.
describe("createUserInputSchema", () => {
  const valid = { fullName: "Kumar", email: "kumar@twinspark.in", password: "password123", role: "sales_person" as const };

  it("accepts valid input", () => {
    expect(createUserInputSchema.parse(valid)).toEqual(valid);
  });

  it("rejects an empty name", () => {
    expect(() => createUserInputSchema.parse({ ...valid, fullName: "  " })).toThrow();
  });

  it("rejects an invalid email", () => {
    expect(() => createUserInputSchema.parse({ ...valid, email: "not-an-email" })).toThrow();
  });

  it("rejects a password under 8 characters", () => {
    expect(() => createUserInputSchema.parse({ ...valid, password: "short" })).toThrow();
  });

  it("rejects a role outside admin/sales_person", () => {
    expect(() => createUserInputSchema.parse({ ...valid, role: "owner" })).toThrow();
  });
});

// USR-020/021: edit form only carries name + role.
describe("updateUserInputSchema", () => {
  it("accepts a name/role change", () => {
    expect(updateUserInputSchema.parse({ fullName: "Kumar S", role: "admin" })).toEqual({
      fullName: "Kumar S",
      role: "admin",
    });
  });

  it("rejects an empty name", () => {
    expect(() => updateUserInputSchema.parse({ fullName: "", role: "admin" })).toThrow();
  });
});

describe("resetPasswordInputSchema", () => {
  it("accepts a password meeting the minimum length", () => {
    expect(resetPasswordInputSchema.parse({ password: "newpassword" })).toEqual({ password: "newpassword" });
  });

  it("rejects a password under 8 characters", () => {
    expect(() => resetPasswordInputSchema.parse({ password: "short" })).toThrow();
  });
});

describe("mechanic role", () => {
  it("exposes exactly the three roles, in dropdown order", () => {
    expect(USER_ROLES).toEqual(["admin", "sales_person", "mechanic"]);
  });

  it("accepts mechanic on create", () => {
    const parsed = createUserInputSchema.parse({
      fullName: "Anand",
      email: "anand@twinspark.in",
      password: "password123",
      role: "mechanic",
    });
    expect(parsed.role).toBe("mechanic");
  });

  it("accepts mechanic on update", () => {
    expect(updateUserInputSchema.parse({ fullName: "Anand", role: "mechanic" }).role).toBe("mechanic");
  });

  it.each(["technician", "", "MECHANIC"])("rejects %s as a role", (role) => {
    expect(() => updateUserInputSchema.parse({ fullName: "Anand", role })).toThrow();
  });
});
