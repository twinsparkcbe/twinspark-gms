import { beforeEach, describe, expect, it, vi } from "vitest";

const getClaimsMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getClaims: getClaimsMock } })),
}));

// getCachedUser is wrapped in React's cache(), which memoizes per module
// instance — reset modules between tests so each gets a fresh cache scope.
// (Same reasoning as get-session-access.test.ts.)
async function loadGetCachedUser() {
  const mod = await import("./get-cached-user");
  return mod.getCachedUser;
}

describe("getCachedUser", () => {
  beforeEach(() => {
    getClaimsMock.mockReset();
    vi.resetModules();
  });

  it("maps a verified token's claims to id/email", async () => {
    getClaimsMock.mockResolvedValue({
      data: { claims: { sub: "u1", email: "admin@twinspark.in" } },
      error: null,
    });
    const getCachedUser = await loadGetCachedUser();

    expect(await getCachedUser()).toEqual({ id: "u1", email: "admin@twinspark.in" });
  });

  it("returns null when there is no session", async () => {
    getClaimsMock.mockResolvedValue({ data: null, error: null });
    const getCachedUser = await loadGetCachedUser();

    expect(await getCachedUser()).toBeNull();
  });

  // An expired or tampered token resolves with an error rather than throwing.
  // Must fail closed so the guards redirect to /login instead of rendering.
  it("returns null when signature verification fails", async () => {
    getClaimsMock.mockResolvedValue({ data: null, error: new Error("invalid JWT") });
    const getCachedUser = await loadGetCachedUser();

    expect(await getCachedUser()).toBeNull();
  });

  // Defensive: `sub` is a required JWT claim, but a token without it can't
  // identify a user, so it must not resolve to a half-built AuthUser.
  it("returns null when the token carries no subject", async () => {
    getClaimsMock.mockResolvedValue({ data: { claims: { email: "x@y.in" } }, error: null });
    const getCachedUser = await loadGetCachedUser();

    expect(await getCachedUser()).toBeNull();
  });

  it("tolerates a token with no email claim", async () => {
    getClaimsMock.mockResolvedValue({ data: { claims: { sub: "u3" } }, error: null });
    const getCachedUser = await loadGetCachedUser();

    expect(await getCachedUser()).toEqual({ id: "u3", email: null });
  });

  // No test for the cache() dedupe: React only memoizes inside a render /
  // request scope, and outside one (as here) every call gets a fresh cache.
  // Asserting it would test React's own behaviour, not ours, and can only be
  // observed for real in the Next.js server runtime.
});
