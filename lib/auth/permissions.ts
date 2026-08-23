/**
 * Central role/permission map. Referenced by the sidebar (to hide nav items)
 * and by server-side route guards (to block direct navigation).
 *
 * Business rule (PRD §6 + doc/mechanic-role-scope.md): Admin has full access.
 * Sales Person is restricted from Inventory, Purchases, Reports, Dashboard,
 * Settings and Service. Mechanic is a Sales Person plus the Service Job
 * lifecycle — but not the Service Catalog, and not service payment status
 * (those two are finer-grained than a module key, see the helpers below).
 *
 * Modelled as an allow-list per role rather than the single blocked-list this
 * used to be: with two differently-restricted roles, "not blocked for Sales
 * Person" stopped being the same question as "allowed for everyone else".
 */
export type UserRole = "admin" | "sales_person" | "mechanic";

export type ModuleKey =
  | "dashboard"
  | "inventory"
  | "purchases"
  | "sales"
  | "service"
  | "billing"
  | "customers"
  | "online-orders"
  | "reports"
  | "settings"
  /** Attendance Management (0031) — standalone staff-attendance module,
   * Admin-only. Carries no relationship to any business workflow. */
  | "attendance";

export const ALL_MODULE_KEYS: readonly ModuleKey[] = [
  "dashboard",
  "inventory",
  "purchases",
  "sales",
  "service",
  "billing",
  "customers",
  "online-orders",
  "reports",
  "settings",
  "attendance",
] as const;

const SHARED_STAFF_MODULES: ModuleKey[] = ["sales", "billing", "customers", "online-orders"];

const MODULE_ACCESS: Record<UserRole, readonly ModuleKey[]> = {
  admin: ALL_MODULE_KEYS,
  sales_person: SHARED_STAFF_MODULES,
  mechanic: [...SHARED_STAFF_MODULES, "service"],
};

export function canAccessModule(role: UserRole, moduleKey: ModuleKey): boolean {
  return MODULE_ACCESS[role]?.includes(moduleKey) ?? false;
}

/**
 * Service Catalog (packages, specific services, combo offers) is price-list
 * setup, not shop-floor work — a Mechanic reads it through the line pickers
 * but never edits it.
 */
export function canManageServiceCatalog(role: UserRole): boolean {
  return role === "admin";
}

/** Cash reconciliation stays with the owner: a Mechanic can complete a job
 * and hand the bike over, but not mark the invoice paid. */
export function canSetServicePaymentStatus(role: UserRole): boolean {
  return role === "admin";
}
