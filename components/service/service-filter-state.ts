import type { UserRole } from "@/lib/auth/permissions";

export interface ServiceFilterState {
  search: string;
  status: string;
  /** "" = all, "UNASSIGNED" = nobody on it, otherwise a mechanic's id. */
  assignedMechanicId: string;
  dateFrom: string;
  dateTo: string;
}

/**
 * A Mechanic opens the Service list to see their own work, so their default
 * view is "My jobs" — including after a filter reset
 * (doc/mechanic-role-scope.md §5). They can still switch to All. The server
 * render applies the same default, so the first client refetch doesn't
 * change what is already on screen.
 *
 * Pure and component-free so both the list client and its tests can use it.
 */
export function buildDefaultServiceFilters(currentUser: { id: string; role: UserRole }): ServiceFilterState {
  return {
    search: "",
    status: "",
    assignedMechanicId: currentUser.role === "mechanic" ? currentUser.id : "",
    dateFrom: "",
    dateTo: "",
  };
}
