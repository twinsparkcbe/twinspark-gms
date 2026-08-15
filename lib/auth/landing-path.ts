import { canAccessModule, type ModuleKey, type UserRole } from "./permissions";

/**
 * Where each role lands after sign-in, and where an Admin-only guard bounces
 * a non-Admin to. One map, because getting this wrong is a redirect loop:
 * "/dashboard" was the original target for everyone and looped a Sales Person
 * straight back into requireAdmin().
 *
 * Every entry must be a module that role can actually access — asserted in
 * landing-path.test.ts rather than left to review.
 */
const LANDING: Record<UserRole, { module: ModuleKey; path: string }> = {
  admin: { module: "dashboard", path: "/dashboard" },
  sales_person: { module: "sales", path: "/sales" },
  mechanic: { module: "service", path: "/service" },
};

export function getLandingPath(role: UserRole): string {
  return LANDING[role]?.path ?? "/sales";
}

export function getLandingModule(role: UserRole): ModuleKey {
  return LANDING[role]?.module ?? "sales";
}

export function isValidLandingFor(role: UserRole): boolean {
  return canAccessModule(role, getLandingModule(role));
}
