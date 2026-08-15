import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

// role/is_active now come from getSessionAccess() (User Roles module) —
// see require-admin.test.ts's header comment for the full rationale.
const getSessionAccessMock = vi.fn();
vi.mock("./get-session-access", () => ({
  getSessionAccess: getSessionAccessMock,
}));

const signOutMock = vi.fn(async () => ({ error: null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { signOut: signOutMock },
  })),
}));

async function loadRequireOnlineOrdersAccess() {
  const mod = await import("./require-online-orders-access");
  return mod.requireOnlineOrdersAccess;
}

describe("requireOnlineOrdersAccess", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    getSessionAccessMock.mockReset();
    signOutMock.mockClear();
    vi.resetModules();
  });

  it("redirects to /login when there is no session", async () => {
    getSessionAccessMock.mockResolvedValue(null);
    const requireOnlineOrdersAccess = await loadRequireOnlineOrdersAccess();

    await expect(requireOnlineOrdersAccess()).rejects.toThrow("REDIRECT:/login");
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });

  // ORD-060: Sales Person can access Online Orders — same tier as Sales,
  // unlike Inventory/Purchases/Reports/Dashboard/Settings.
  it("returns the user when they are an active Sales Person, without redirecting", async () => {
    getSessionAccessMock.mockResolvedValue({
      userId: "u1",
      email: "sales@twinspark.in",
      fullName: null,
      role: "sales_person",
      isActive: true,
    });
    const requireOnlineOrdersAccess = await loadRequireOnlineOrdersAccess();

    const result = await requireOnlineOrdersAccess();

    expect(result).toEqual({ userId: "u1", email: "sales@twinspark.in", role: "sales_person" });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("returns the user when they are an active Admin, without redirecting", async () => {
    getSessionAccessMock.mockResolvedValue({
      userId: "u2",
      email: "admin@twinspark.in",
      fullName: "Admin",
      role: "admin",
      isActive: true,
    });
    const requireOnlineOrdersAccess = await loadRequireOnlineOrdersAccess();

    const result = await requireOnlineOrdersAccess();

    expect(result).toEqual({ userId: "u2", email: "admin@twinspark.in", role: "admin" });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  // USR-003
  it("signs out and redirects to /login when the account is deactivated", async () => {
    getSessionAccessMock.mockResolvedValue({
      userId: "u1",
      email: "sales@twinspark.in",
      fullName: null,
      role: "sales_person",
      isActive: false,
    });
    const requireOnlineOrdersAccess = await loadRequireOnlineOrdersAccess();

    await expect(requireOnlineOrdersAccess()).rejects.toThrow("REDIRECT:/login");
    expect(signOutMock).toHaveBeenCalled();
  });
});

// Mechanic (0026) shares every module a Sales Person can use, so this guard
// must let them through too — not just Admin and Sales Person.
describe("requireOnlineOrdersAccess — Mechanic", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    getSessionAccessMock.mockReset();
    signOutMock.mockClear();
    vi.resetModules();
  });

  it("allows an active Mechanic", async () => {
    getSessionAccessMock.mockResolvedValue({
      userId: "u9",
      email: "mechanic@twinspark.in",
      fullName: "Anand",
      role: "mechanic",
      isActive: true,
    });
    const guard = await loadRequireOnlineOrdersAccess();

    await expect(guard()).resolves.toEqual({ userId: "u9", email: "mechanic@twinspark.in", role: "mechanic" });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("signs out and redirects a deactivated Mechanic", async () => {
    getSessionAccessMock.mockResolvedValue({
      userId: "u9",
      email: "mechanic@twinspark.in",
      fullName: "Anand",
      role: "mechanic",
      isActive: false,
    });
    const guard = await loadRequireOnlineOrdersAccess();

    await expect(guard()).rejects.toThrow("REDIRECT:/login");
    expect(signOutMock).toHaveBeenCalled();
  });
});
