import { Badge } from "@/components/ui/badge";
import type { UserRole } from "@/lib/auth/permissions";

import { ROLE_BADGE_VARIANTS, ROLE_LABELS } from "./role-labels";

export function UserRoleBadge({ role }: { role: UserRole }) {
  return <Badge variant={ROLE_BADGE_VARIANTS[role]}>{ROLE_LABELS[role]}</Badge>;
}
