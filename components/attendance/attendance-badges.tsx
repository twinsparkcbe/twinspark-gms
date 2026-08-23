import { Badge } from "@/components/ui/badge";
import { ATTENDANCE_ROLE_LABELS, ATTENDANCE_STATUS_LABELS, roleDisplayLabel } from "@/services/attendance/schemas";
import type { AttendanceRole, AttendanceStatus } from "@/types/database.types";

/**
 * Status badges use the existing semantic Badge variants only — no new
 * colors (twinspark-style-guide.md §12). Full Day is the positive/normal
 * state, the two half days are informational (kept visually distinct from
 * each other so a glance down the column separates them), and Absent is the
 * one that should catch the eye.
 */
const STATUS_VARIANT: Record<AttendanceStatus, "success" | "info" | "channel" | "danger"> = {
  FULL_DAY: "success",
  FIRST_HALF: "info",
  SECOND_HALF: "channel",
  ABSENT: "danger",
};

export function AttendanceStatusBadge({ status }: { status: AttendanceStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{ATTENDANCE_STATUS_LABELS[status]}</Badge>;
}

/** Shown when an active employee has no record for the selected date yet —
 * deliberately not the same thing as Absent. */
export function NotMarkedBadge() {
  return <Badge variant="neutral">Not marked</Badge>;
}

/**
 * Shows what someone actually does. For Other Staff that's the description
 * they were added with ("Watchman"), with the bucket name kept in the
 * tooltip — a column listing four people as "Other Staff" is no use to the
 * person reading it.
 */
export function AttendanceRoleBadge({
  role,
  otherRoleDescription,
}: {
  role: AttendanceRole;
  otherRoleDescription?: string | null;
}) {
  const label = roleDisplayLabel(role, otherRoleDescription);
  const isDescribed = label !== ATTENDANCE_ROLE_LABELS[role];

  return (
    <Badge variant="neutral" title={isDescribed ? ATTENDANCE_ROLE_LABELS[role] : undefined} className="max-w-full truncate">
      {label}
    </Badge>
  );
}
