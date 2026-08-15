import type { UserRole } from "@/lib/auth/permissions";

/** Display name per role — one map, so the badge, the filter chips and any
 * future role-aware copy can never disagree. */
export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Administrator",
  sales_person: "Sales Person",
  mechanic: "Mechanic",
};

export const ROLE_BADGE_VARIANTS: Record<UserRole, "info" | "neutral" | "channel"> = {
  admin: "info",
  sales_person: "neutral",
  mechanic: "channel",
};
