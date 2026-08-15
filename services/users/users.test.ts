import { describe, expect, it, vi } from "vitest";

import {
  createUser,
  DuplicateEmailError,
  LastAdminError,
  listUsers,
  resetUserPassword,
  SelfDeactivationError,
  setUserActive,
  updateUser,
  UserNotFoundError,
} from "./users";

/**
 * Lightweight stand-in for the service-role Supabase client. Unlike
 * test/supabase-query-mock.ts (built for RPC-shaped modules that make one
 * `.from()` call per test), this module's functions make several sequential
 * `.from("profiles")` calls per operation (read-then-write, or a guardrail
 * lookup before the write) — `fromResults` is consumed in call order so
 * each `.from()` in a test gets its own canned result.
 */
function createChainable(result: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "insert", "update", "delete", "eq", "neq"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.then = (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function createAdminClientMock(opts: {
  fromResults?: unknown[];
  createUser?: unknown;
  getUserById?: unknown[];
  updateUserById?: unknown;
  deleteUser?: unknown;
  listUsers?: unknown;
}) {
  const fromResults = opts.fromResults ?? [];
  let fromIndex = 0;
  const from = vi.fn(() => {
    const result = fromResults[fromIndex] ?? fromResults[fromResults.length - 1];
    fromIndex += 1;
    return createChainable(result);
  });

  const getUserByIdResults = opts.getUserById ?? [];
  let getUserByIdIndex = 0;
  const getUserById = vi.fn(async () => {
    const result = getUserByIdResults[getUserByIdIndex] ?? getUserByIdResults[getUserByIdResults.length - 1];
    getUserByIdIndex += 1;
    return result;
  });

  return {
    from,
    auth: {
      admin: {
        createUser: vi.fn(async () => opts.createUser ?? { data: { user: null }, error: null }),
        getUserById,
        updateUserById: vi.fn(async () => opts.updateUserById ?? { data: { user: null }, error: null }),
        deleteUser: vi.fn(async () => opts.deleteUser ?? { data: {}, error: null }),
        listUsers: vi.fn(async () => opts.listUsers ?? { data: { users: [] }, error: null }),
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const profileRow = {
  id: "user-1",
  full_name: "Kumar",
  role: "sales_person" as const,
  is_active: true,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
};

describe("createUser", () => {
  // USR-010
  it("creates the auth user and a matching profile row, defaulting is_active to true", async () => {
    const authUser = { id: "user-1", email: "kumar@twinspark.in" };
    const client = createAdminClientMock({
      createUser: { data: { user: authUser }, error: null },
      fromResults: [{ data: profileRow, error: null }],
    });

    const result = await createUser(client, {
      fullName: "Kumar",
      email: "kumar@twinspark.in",
      password: "password123",
      role: "sales_person",
    });

    expect(client.auth.admin.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "kumar@twinspark.in", password: "password123", email_confirm: true })
    );
    expect(result).toEqual({
      id: "user-1",
      email: "kumar@twinspark.in",
      fullName: "Kumar",
      role: "sales_person",
      isActive: true,
      createdAt: profileRow.created_at,
      updatedAt: profileRow.updated_at,
    });
  });

  // USR-011
  it("throws DuplicateEmailError when the Auth API reports the email already exists", async () => {
    const client = createAdminClientMock({
      createUser: { data: { user: null }, error: { code: "email_exists", message: "A user with this email address has already been registered" } },
    });

    await expect(
      createUser(client, { fullName: "Kumar", email: "dupe@twinspark.in", password: "password123", role: "sales_person" })
    ).rejects.toThrow(DuplicateEmailError);
  });

  // USR-012 (schema layer) — service function also rejects invalid input before calling Supabase at all.
  it("rejects invalid input without calling the Auth API", async () => {
    const client = createAdminClientMock({});
    await expect(
      createUser(client, { fullName: "", email: "kumar@twinspark.in", password: "password123", role: "sales_person" })
    ).rejects.toThrow();
    expect(client.auth.admin.createUser).not.toHaveBeenCalled();
  });

  // USR-013 + rollback safety net: if the profile insert fails after the auth
  // user was created, the auth user is deleted again rather than left orphaned.
  it("rolls back the created auth user if the profile insert fails", async () => {
    const authUser = { id: "user-1", email: "kumar@twinspark.in" };
    const client = createAdminClientMock({
      createUser: { data: { user: authUser }, error: null },
      fromResults: [{ data: null, error: { message: "insert failed" } }],
    });

    await expect(
      createUser(client, { fullName: "Kumar", email: "kumar@twinspark.in", password: "password123", role: "sales_person" })
    ).rejects.toThrow();
    expect(client.auth.admin.deleteUser).toHaveBeenCalledWith("user-1");
  });
});

describe("updateUser", () => {
  // USR-020/021
  it("updates name/role in profiles and syncs user_metadata for JWT-backed RLS", async () => {
    const updatedProfile = { ...profileRow, full_name: "Kumar S", role: "admin" as const };
    const authUser = { id: "user-1", email: "kumar@twinspark.in" };
    const client = createAdminClientMock({
      fromResults: [{ data: updatedProfile, error: null }],
      updateUserById: { data: { user: authUser }, error: null },
      getUserById: [{ data: { user: authUser }, error: null }],
    });

    const result = await updateUser(client, "user-1", { fullName: "Kumar S", role: "admin" });

    expect(client.auth.admin.updateUserById).toHaveBeenCalledWith("user-1", {
      user_metadata: { full_name: "Kumar S", role: "admin" },
    });
    expect(result.fullName).toBe("Kumar S");
    expect(result.role).toBe("admin");
  });

  it("throws UserNotFoundError when the profile row doesn't exist", async () => {
    const client = createAdminClientMock({ fromResults: [{ data: null, error: null }] });
    await expect(updateUser(client, "missing", { fullName: "X", role: "admin" })).rejects.toThrow(UserNotFoundError);
  });
});

describe("resetUserPassword", () => {
  // USR-030
  it("calls updateUserById with the new password only", async () => {
    const client = createAdminClientMock({ updateUserById: { data: { user: {} }, error: null } });
    await resetUserPassword(client, "user-1", { password: "newpassword1" });
    expect(client.auth.admin.updateUserById).toHaveBeenCalledWith("user-1", { password: "newpassword1" });
  });

  it("rejects an under-strength password before calling the Auth API", async () => {
    const client = createAdminClientMock({});
    await expect(resetUserPassword(client, "user-1", { password: "short" })).rejects.toThrow();
    expect(client.auth.admin.updateUserById).not.toHaveBeenCalled();
  });
});

describe("setUserActive", () => {
  // USR-040
  it("activates/deactivates a non-admin target with no guardrail checks", async () => {
    const deactivated = { ...profileRow, is_active: false };
    const authUser = { id: "user-1", email: "kumar@twinspark.in" };
    const client = createAdminClientMock({
      fromResults: [
        { data: { role: "sales_person" }, error: null }, // target role lookup
        { data: deactivated, error: null }, // the update
      ],
      getUserById: [{ data: { user: authUser }, error: null }],
    });

    const result = await setUserActive(client, "admin-1", "user-1", false);
    expect(result.isActive).toBe(false);
  });

  // USR-042
  it("throws SelfDeactivationError when an admin tries to deactivate their own account", async () => {
    const client = createAdminClientMock({});
    await expect(setUserActive(client, "admin-1", "admin-1", false)).rejects.toThrow(SelfDeactivationError);
    expect(client.from).not.toHaveBeenCalled();
  });

  // USR-043
  it("throws LastAdminError when deactivating the last active admin", async () => {
    const client = createAdminClientMock({
      fromResults: [
        { data: { role: "admin" }, error: null }, // target role lookup
        { data: null, error: null, count: 0 }, // no other active admins
      ],
    });

    await expect(setUserActive(client, "admin-1", "admin-2", false)).rejects.toThrow(LastAdminError);
  });

  // USR-043 (allowed case) — a second active admin exists, so deactivation proceeds.
  it("allows deactivating an admin when another active admin remains", async () => {
    const deactivated = { ...profileRow, role: "admin" as const, is_active: false };
    const authUser = { id: "admin-2", email: "admin2@twinspark.in" };
    const client = createAdminClientMock({
      fromResults: [
        { data: { role: "admin" }, error: null },
        { data: null, error: null, count: 1 }, // one other active admin
        { data: deactivated, error: null }, // the update
      ],
      getUserById: [{ data: { user: authUser }, error: null }],
    });

    const result = await setUserActive(client, "admin-1", "admin-2", false);
    expect(result.isActive).toBe(false);
  });

  // USR-041
  it("reactivating skips both guardrails entirely", async () => {
    const reactivated = { ...profileRow, is_active: true };
    const authUser = { id: "user-1", email: "kumar@twinspark.in" };
    const client = createAdminClientMock({
      fromResults: [{ data: reactivated, error: null }],
      getUserById: [{ data: { user: authUser }, error: null }],
    });

    const result = await setUserActive(client, "admin-1", "user-1", true);
    expect(result.isActive).toBe(true);
    expect(client.from).toHaveBeenCalledTimes(1); // straight to the update, no role/count lookup
  });
});

describe("listUsers", () => {
  // USR-050
  it("joins auth users with their profile row and sorts by created_at ascending", async () => {
    const authUsers = [
      { id: "user-2", email: "b@twinspark.in" },
      { id: "user-1", email: "a@twinspark.in" },
    ];
    const profiles = [
      { ...profileRow, id: "user-2", created_at: "2026-08-02T00:00:00.000Z" },
      { ...profileRow, id: "user-1", created_at: "2026-08-01T00:00:00.000Z" },
    ];
    const client = createAdminClientMock({
      listUsers: { data: { users: authUsers }, error: null },
      fromResults: [{ data: profiles, error: null }],
    });

    const result = await listUsers(client);
    expect(result.map((r) => r.id)).toEqual(["user-1", "user-2"]);
    expect(result[0].email).toBe("a@twinspark.in");
  });

  it("skips a profile row with no matching auth user", async () => {
    const client = createAdminClientMock({
      listUsers: { data: { users: [{ id: "user-1", email: "a@twinspark.in" }] }, error: null },
      fromResults: [{ data: [profileRow, { ...profileRow, id: "orphan" }], error: null }],
    });

    const result = await listUsers(client);
    expect(result.map((r) => r.id)).toEqual(["user-1"]);
  });
});

describe("mechanic role", () => {
  it("creates a Mechanic with role mechanic on both the auth user and the profile", async () => {
    const authUser = { id: "user-9", email: "anand@twinspark.in" };
    const mechanicProfile = { ...profileRow, id: "user-9", full_name: "Anand", role: "mechanic" as const };
    const client = createAdminClientMock({
      createUser: { data: { user: authUser }, error: null },
      fromResults: [{ data: mechanicProfile, error: null }],
    });

    const result = await createUser(client, {
      fullName: "Anand",
      email: "anand@twinspark.in",
      password: "password123",
      role: "mechanic",
    });

    expect(client.auth.admin.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ user_metadata: expect.objectContaining({ role: "mechanic" }) })
    );
    expect(result.role).toBe("mechanic");
  });

  it("syncs user_metadata.role when promoting a Sales Person to Mechanic", async () => {
    const updatedProfile = { ...profileRow, role: "mechanic" as const };
    const authUser = { id: "user-1", email: "kumar@twinspark.in" };
    const client = createAdminClientMock({
      // 1st .from(): the last-admin guard's role lookup. 2nd: the update.
      fromResults: [{ data: { role: "sales_person" }, error: null }, { data: updatedProfile, error: null }],
      updateUserById: { data: { user: authUser }, error: null },
      getUserById: [{ data: { user: authUser }, error: null }],
    });

    const result = await updateUser(client, "user-1", { fullName: "Kumar", role: "mechanic" });

    expect(client.auth.admin.updateUserById).toHaveBeenCalledWith("user-1", {
      user_metadata: { full_name: "Kumar", role: "mechanic" },
    });
    expect(result.role).toBe("mechanic");
  });

  // Demoting the last Admin locks everyone out of Settings just as surely as
  // deactivating them — and with a third role, it is a realistic misclick.
  it("refuses to demote the last active Administrator to Mechanic", async () => {
    const client = createAdminClientMock({
      fromResults: [{ data: { role: "admin" }, error: null }, { data: null, error: null, count: 0 }],
      updateUserById: { data: { user: null }, error: null },
    });

    await expect(updateUser(client, "user-1", { fullName: "Owner", role: "mechanic" })).rejects.toThrow(LastAdminError);
    expect(client.auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  it("allows demoting an Admin while another active Admin remains", async () => {
    const updatedProfile = { ...profileRow, role: "mechanic" as const };
    const authUser = { id: "user-1", email: "kumar@twinspark.in" };
    const client = createAdminClientMock({
      fromResults: [
        { data: { role: "admin" }, error: null },
        { data: null, error: null, count: 1 },
        { data: updatedProfile, error: null },
      ],
      updateUserById: { data: { user: authUser }, error: null },
      getUserById: [{ data: { user: authUser }, error: null }],
    });

    await expect(updateUser(client, "user-1", { fullName: "Kumar", role: "mechanic" })).resolves.toMatchObject({
      role: "mechanic",
    });
  });

  // There is no "last mechanic" rule — only Admins are load-bearing.
  it("deactivates the only Mechanic without complaint", async () => {
    const authUser = { id: "user-9", email: "anand@twinspark.in" };
    const client = createAdminClientMock({
      fromResults: [
        { data: { role: "mechanic" }, error: null },
        { data: { ...profileRow, id: "user-9", role: "mechanic" as const, is_active: false }, error: null },
      ],
      getUserById: [{ data: { user: authUser }, error: null }],
    });

    await expect(setUserActive(client, "admin-1", "user-9", false)).resolves.toMatchObject({ isActive: false });
  });
});
