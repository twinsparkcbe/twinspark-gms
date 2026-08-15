import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

// requireAdmin() now resolves role/is_active through getSessionAccess()
// (User Roles module — reads the real `profiles` table) instead of the old
// user_metadata stopgap this file used to mock supabase.auth.getUser()
// directly for. Mocking getSessionAccess() here keeps this test focused on
// requireAdmin()'s own redirect/sign-out logic; getSessionAccess()'s own
// profile-resolution logic has its own tests in get-session-access.test.ts.
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

// vi.resetModules() between tests matches getSessionAccess()'s own
// per-request cache() scope, same reasoning as before this refactor.
async function loadRequireAdmin() {
  const mod = await import("./require-admin");
  return mod.requireAdmin;
}

describe("requireAdmin", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    getSessionAccessMock.mockReset();
    signOutMock.mockClear();
    vi.resetModules();
  });

  it("redirects to /login when there is no session", async () => {
    getSessionAccessMock.mockResolvedValue(null);
    const requireAdmin = await loadRequireAdmin();

    await expect(requireAdmin()).rejects.toThrow("REDIRECT:/login");
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });

  // INV-056/057: a Sales Person hitting an Admin-only route directly is
  // blocked server-side, not just hidden from the sidebar. Redirects to
  // /sales (not /dashboard) — /dashboard is itself Admin-only, so redirecting
  // there looped a Sales Person straight back to this same check.
  it("redirects to /sales when the user is an active Sales Person", async () => {
    getSessionAccessMock.mockResolvedValue({
      userId: "u1",
      email: "sales@twinspark.in",
      fullName: null,
      role: "sales_person",
      isActive: true,
    });
    const requireAdmin = await loadRequireAdmin();

    await expect(requireAdmin()).rejects.toThrow("REDIRECT:/sales");
    expect(redirectMock).toHaveBeenCalledWith("/sales");
  });

  // INV-058: Admin passes through with their user info.
  it("returns the user when they are an active Admin", async () => {
    getSessionAccessMock.mockResolvedValue({
      userId: "u1",
      email: "admin@twinspark.in",
      fullName: "Admin",
      role: "admin",
      isActive: true,
    });
    const requireAdmin = await loadRequireAdmin();

    const result = await requireAdmin();

    expect(result).toEqual({ userId: "u1", email: "admin@twinspark.in", role: "admin" });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  // USR-003: implements what was previously an it.todo (INV-059), pending
  // the User Roles module's profiles.is_active column, which now exists.
  // A deactivated account is signed out (clearing its session cookie) and
  // redirected — even an Admin role doesn't override this.
  it("USR-003: signs out and redirects to /login when the account is deactivated", async () => {
    getSessionAccessMock.mockResolvedValue({
      userId: "u1",
      email: "admin@twinspark.in",
      fullName: "Admin",
      role: "admin",
      isActive: false,
    });
    const requireAdmin = await loadRequireAdmin();

    await expect(requireAdmin()).rejects.toThrow("REDIRECT:/login");
    expect(signOutMock).toHaveBeenCalled();
  });
});

describe("requireAdmin — Mechanic", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    getSessionAccessMock.mockReset();
    signOutMock.mockClear();
    vi.resetModules();
  });

  // Bounced to /service, not /sales: Service is a Mechanic's landing module
  // (lib/auth/landing-path.ts), and /dashboard would loop straight back here.
  it("redirects an active Mechanic to /service", async () => {
    getSessionAccessMock.mockResolvedValue({
      userId: "u9",
      email: "mechanic@twinspark.in",
      fullName: "Anand",
      role: "mechanic",
      isActive: true,
    });
    const requireAdmin = await loadRequireAdmin();

    await expect(requireAdmin()).rejects.toThrow("REDIRECT:/service");
  });

  it("signs out and redirects a deactivated Mechanic", async () => {
    getSessionAccessMock.mockResolvedValue({
      userId: "u9",
      email: "mechanic@twinspark.in",
      fullName: "Anand",
      role: "mechanic",
      isActive: false,
    });
    const requireAdmin = await loadRequireAdmin();

    await expect(requireAdmin()).rejects.toThrow("REDIRECT:/login");
    expect(signOutMock).toHaveBeenCalled();
  });
});
