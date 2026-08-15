import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserMock = vi.fn();
vi.mock("./get-cached-user", () => ({
  getCachedUser: getUserMock,
}));

const maybeSingleMock = vi.fn();
const fromChain = {
  select: vi.fn(() => fromChain),
  eq: vi.fn(() => fromChain),
  maybeSingle: maybeSingleMock,
};
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from: vi.fn(() => fromChain) })),
}));

// Same reasoning as require-admin.test.ts: getSessionAccess is wrapped in
// React's cache(), which memoizes per module instance — reset modules
// between tests so each test gets a fresh cache scope.
async function loadGetSessionAccess() {
  const mod = await import("./get-session-access");
  return mod.getSessionAccess;
}

describe("getSessionAccess", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    maybeSingleMock.mockReset();
    vi.resetModules();
  });

  it("returns null when there is no session", async () => {
    getUserMock.mockResolvedValue(null);
    const getSessionAccess = await loadGetSessionAccess();

    expect(await getSessionAccess()).toBeNull();
  });

  // USR-001
  it("resolves an active Admin's role/name from profiles", async () => {
    getUserMock.mockResolvedValue({ id: "u1", email: "admin@twinspark.in" });
    maybeSingleMock.mockResolvedValue({ data: { full_name: "Admin", role: "admin", is_active: true }, error: null });
    const getSessionAccess = await loadGetSessionAccess();

    expect(await getSessionAccess()).toEqual({
      userId: "u1",
      email: "admin@twinspark.in",
      fullName: "Admin",
      role: "admin",
      isActive: true,
    });
  });

  // USR-002
  it("resolves an active Sales Person's role from profiles", async () => {
    getUserMock.mockResolvedValue({ id: "u2", email: "sales@twinspark.in" });
    maybeSingleMock.mockResolvedValue({ data: { full_name: "Sales", role: "sales_person", is_active: true }, error: null });
    const getSessionAccess = await loadGetSessionAccess();

    expect((await getSessionAccess())?.role).toBe("sales_person");
  });

  // USR-003
  it("reports isActive: false for a deactivated profile", async () => {
    getUserMock.mockResolvedValue({ id: "u1", email: "admin@twinspark.in" });
    maybeSingleMock.mockResolvedValue({ data: { full_name: "Admin", role: "admin", is_active: false }, error: null });
    const getSessionAccess = await loadGetSessionAccess();

    expect((await getSessionAccess())?.isActive).toBe(false);
  });

  // USR-004: no profiles row at all — fails closed (most-restricted role, inactive)
  // rather than trusting stale auth metadata.
  it("fails closed when no profile row exists for the auth user", async () => {
    getUserMock.mockResolvedValue({ id: "u3", email: "orphan@twinspark.in" });
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    const getSessionAccess = await loadGetSessionAccess();

    expect(await getSessionAccess()).toEqual({
      userId: "u3",
      email: "orphan@twinspark.in",
      fullName: null,
      role: "sales_person",
      isActive: false,
    });
  });
});

describe("getSessionAccess — Mechanic", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    maybeSingleMock.mockReset();
    vi.resetModules();
  });

  it("returns the mechanic role verbatim from the profile row", async () => {
    getUserMock.mockResolvedValue({ id: "u9", email: "mechanic@twinspark.in" });
    maybeSingleMock.mockResolvedValue({ data: { full_name: "Anand", role: "mechanic", is_active: true }, error: null });
    const getSessionAccess = await loadGetSessionAccess();

    expect(await getSessionAccess()).toEqual({
      userId: "u9",
      email: "mechanic@twinspark.in",
      fullName: "Anand",
      role: "mechanic",
      isActive: true,
    });
  });

  // The fail-closed fallback must stay the *most* restricted role. Mechanic
  // is not it — they can reach Service, which a Sales Person cannot.
  it("still falls back to sales_person, not mechanic, when no profile exists", async () => {
    getUserMock.mockResolvedValue({ id: "u3", email: "orphan@twinspark.in" });
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    const getSessionAccess = await loadGetSessionAccess();

    expect((await getSessionAccess())?.role).toBe("sales_person");
  });
});
