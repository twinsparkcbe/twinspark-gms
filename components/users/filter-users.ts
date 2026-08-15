import type { ProfileRow } from "@/services/users";
import type { UserRoleEnum } from "@/types/database.types";

export interface UserFilterState {
  search: string;
  roles: UserRoleEnum[];
  statuses: ("active" | "inactive")[];
}

export const DEFAULT_USER_FILTERS: UserFilterState = {
  search: "",
  roles: [],
  statuses: [],
};

export function hasActiveUserFilters(filters: UserFilterState): boolean {
  return filters.search.trim() !== "" || filters.roles.length > 0 || filters.statuses.length > 0;
}

/**
 * Client-side filtering, unlike Purchases/Online Orders which filter in the
 * query: the users list is a single garage's staff roster loaded in full
 * (services/users/users.ts listUsers() — no pagination), so there's nothing
 * to gain from a server round trip per keystroke.
 *
 * Empty multi-selects mean "all" rather than "none"; within a facet the
 * selected values are OR'd, and the facets are AND'd together — same
 * semantics as the MultiSelect filters elsewhere.
 */
export function filterUsers(users: ProfileRow[], filters: UserFilterState): ProfileRow[] {
  const search = filters.search.trim().toLowerCase();

  return users.filter((user) => {
    if (search && !user.fullName.toLowerCase().includes(search) && !user.email.toLowerCase().includes(search)) {
      return false;
    }
    if (filters.roles.length > 0 && !filters.roles.includes(user.role)) {
      return false;
    }
    if (filters.statuses.length > 0 && !filters.statuses.includes(user.isActive ? "active" : "inactive")) {
      return false;
    }
    return true;
  });
}
