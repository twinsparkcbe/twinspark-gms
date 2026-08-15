"use client";

import { KeyRound, Pencil, Power, PowerOff, Users as UsersIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ProfileRow } from "@/services/users";

import { UserRoleBadge } from "./role-badge";

// Name | Email | Role | Status | Created | Actions
const ROW_GRID_CLASS = "grid grid-cols-[minmax(140px,200px)_minmax(180px,260px)_140px_100px_120px_140px] gap-3";

export function UsersTable({
  users,
  allUsers,
  isFiltered,
  currentUserId,
  onEdit,
  onResetPassword,
  onToggleActive,
}: {
  /** Rows to render — already filtered. */
  users: ProfileRow[];
  /** Unfiltered roster, used only for the last-active-admin guardrail. */
  allUsers: ProfileRow[];
  isFiltered: boolean;
  currentUserId: string;
  onEdit: (user: ProfileRow) => void;
  onResetPassword: (user: ProfileRow) => void;
  onToggleActive: (user: ProfileRow) => void;
}) {
  const activeAdminCount = allUsers.filter((u) => u.role === "admin" && u.isActive).length;

  return (
    <div className="overflow-x-auto">
      <div role="table" aria-label="Users" className="min-w-[900px]">
        <div role="row" className={cn(ROW_GRID_CLASS, "px-4 py-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase")}>
          <span>Name</span>
          <span>Email</span>
          <span>Role</span>
          <span>Status</span>
          <span>Created</span>
          <span className="text-right">Actions</span>
        </div>

        <div className="flex flex-col gap-2">
          {users.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <UsersIcon className="size-10 text-neutral-300" />
              <p className="text-sm font-medium text-neutral-700">{isFiltered ? "No users match these filters" : "No users yet"}</p>
              <p className="text-sm text-neutral-500">
                {isFiltered ? "Try a different search term, role, or status." : "Add a staff account to get started."}
              </p>
            </div>
          )}

          {users.map((user) => {
            const isSelf = user.id === currentUserId;
            // Guardrails also enforced server-side (setUserActive) — disabling
            // here is a proactive UX nicety, not the real defense.
            const isLastActiveAdmin = user.role === "admin" && user.isActive && activeAdminCount <= 1;
            const deactivateDisabled = user.isActive && (isSelf || isLastActiveAdmin);
            const deactivateTitle = isSelf
              ? "You cannot deactivate your own account"
              : isLastActiveAdmin
                ? "At least one active Administrator must remain"
                : user.isActive
                  ? "Deactivate"
                  : "Activate";

            return (
              <div
                key={user.id}
                role="row"
                className={cn(ROW_GRID_CLASS, "items-center rounded-[10px] border border-neutral-200 bg-white px-4 py-3 shadow-sm transition-colors hover:bg-neutral-50")}
              >
                <div role="cell" aria-label="Name" className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold text-neutral-900" title={user.fullName}>
                      {user.fullName}
                    </span>
                    {isSelf && <Badge variant="neutral">You</Badge>}
                  </div>
                </div>

                <div role="cell" aria-label="Email" className="min-w-0 truncate font-mono text-[13px] text-neutral-600">
                  {user.email}
                </div>

                <div role="cell" aria-label="Role" className="min-w-0">
                  <UserRoleBadge role={user.role} />
                </div>

                <div role="cell" aria-label="Status" className="min-w-0">
                  <Badge variant={user.isActive ? "success" : "neutral"}>{user.isActive ? "Active" : "Inactive"}</Badge>
                </div>

                <div role="cell" aria-label="Created" className="min-w-0 text-sm text-neutral-500">
                  {formatDate(user.createdAt)}
                </div>

                <div role="cell" aria-label="Actions" className="flex justify-end gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Edit user"
                    title="Edit"
                    className="size-9 rounded-[10px] text-neutral-500 hover:text-neutral-900"
                    onClick={() => onEdit(user)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Reset password"
                    title="Reset Password"
                    className="size-9 rounded-[10px] text-neutral-500 hover:text-neutral-900"
                    onClick={() => onResetPassword(user)}
                  >
                    <KeyRound className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={deactivateTitle}
                    title={deactivateTitle}
                    disabled={deactivateDisabled}
                    className={cn(
                      "size-9 rounded-[10px]",
                      user.isActive ? "text-danger hover:text-danger" : "text-success hover:text-success"
                    )}
                    onClick={() => onToggleActive(user)}
                  >
                    {user.isActive ? <PowerOff className="size-4" /> : <Power className="size-4" />}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
