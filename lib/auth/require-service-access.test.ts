import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

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

async function loadGuard() {
  const mod = await import("./require-service-access");
  return mod.requireServiceAccess;
}

function access(overrides: Record<string, unknown> = {}) {
  return {
    userId: "u1",
    email: "staff@twinspark.in",
    fullName: null,
    role: "mechanic",
    isActive: true,
    ...overrides,
  };
}

describe("requireServiceAccess", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    getSessionAccessMock.mockReset();
    signOutMock.mockClear();
    vi.resetModules();
  });

  it("redirects to /login when there is no session", async () => {
    getSessionAccessMock.mockResolvedValue(null);
    const requireServiceAccess = await loadGuard();

    await expect(requireServiceAccess()).rejects.toThrow("REDIRECT:/login");
  });

  it("allows an active Administrator", async () => {
    getSessionAccessMock.mockResolvedValue(access({ role: "admin", email: "owner@twinspark.in" }));
    const requireServiceAccess = await loadGuard();

    await expect(requireServiceAccess()).resolves.toEqual({ userId: "u1", email: "owner@twinspark.in", role: "admin" });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("allows an active Mechanic", async () => {
    getSessionAccessMock.mockResolvedValue(access());
    const requireServiceAccess = await loadGuard();

    await expect(requireServiceAccess()).resolves.toEqual({ userId: "u1", email: "staff@twinspark.in", role: "mechanic" });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  // Sales Person has zero Service access — not even a redacted view.
  it("redirects an active Sales Person to /sales", async () => {
    getSessionAccessMock.mockResolvedValue(access({ role: "sales_person" }));
    const requireServiceAccess = await loadGuard();

    await expect(requireServiceAccess()).rejects.toThrow("REDIRECT:/sales");
  });

  it("signs out and redirects a deactivated Mechanic", async () => {
    getSessionAccessMock.mockResolvedValue(access({ isActive: false }));
    const requireServiceAccess = await loadGuard();

    await expect(requireServiceAccess()).rejects.toThrow("REDIRECT:/login");
    expect(signOutMock).toHaveBeenCalled();
  });

  it("signs out and redirects a deactivated Administrator", async () => {
    getSessionAccessMock.mockResolvedValue(access({ role: "admin", isActive: false }));
    const requireServiceAccess = await loadGuard();

    await expect(requireServiceAccess()).rejects.toThrow("REDIRECT:/login");
    expect(signOutMock).toHaveBeenCalled();
  });
});
