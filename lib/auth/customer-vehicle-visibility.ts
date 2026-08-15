import { canAccessModule, type UserRole } from "./permissions";

export interface CustomerVehicleVisibility {
  /** Whether the "Vehicles" tab shows at all on the /customers page. */
  vehiclesTab: boolean;
  /** Whether Customer Detail's Vehicles section renders. */
  vehiclesSection: boolean;
  /** Whether Customer Detail's Service History section renders. */
  serviceHistory: boolean;
  /** Sales history is visible to both roles — kept as an explicit field
   * (rather than assumed) so callers never have to special-case it. */
  salesHistory: boolean;
}

/**
 * Content-visibility rule for the Customer & Vehicle module
 * (doc/customer-vehicle-scope.md §3). Per the spec's permission matrix,
 * Customer Management is available to both roles but Vehicle Management is
 * Admin-only — "tied to Service, which Sales Person cannot access"
 * (`service` is already in `SALES_PERSON_BLOCKED`, lib/auth/permissions.ts).
 * `"customers"` itself is *not* blocked for Sales Person, so the access gate
 * for the page stays at the module level; this is the finer-grained,
 * within-page rule for which sections a Sales Person actually sees.
 *
 * Kept as a standalone pure function (no DB, no auth call) so the Vehicles
 * tab, the Customer Detail page, and the Vehicle Detail route guard all
 * read the same rule instead of re-deriving it three times.
 *
 * Mechanic sees the vehicle/service sections too (doc/mechanic-role-scope.md
 * §2) — they are exactly the staff who need a bike's service history. The
 * rule tracks Service module access, so it is derived from the same
 * canAccessModule("service") check rather than a second hardcoded role list.
 *
 * An unknown/undefined role resolves to the same shape as "sales_person" —
 * the more restrictive default, matching every other role fallback in this
 * codebase (e.g. require-sales-access.ts).
 */
export function getCustomerVehicleVisibility(role: UserRole | undefined): CustomerVehicleVisibility {
  const hasServiceAccess = role !== undefined && canAccessModule(role, "service");
  return {
    vehiclesTab: hasServiceAccess,
    vehiclesSection: hasServiceAccess,
    serviceHistory: hasServiceAccess,
    salesHistory: true,
  };
}
