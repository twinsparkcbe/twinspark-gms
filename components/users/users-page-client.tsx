"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { ProfileRow } from "@/services/users";

import { setUserActiveAction } from "@/app/(app)/settings/users/actions";

import { ConfirmUserStatusDialog } from "./confirm-status-dialog";
import { DEFAULT_USER_FILTERS, filterUsers, hasActiveUserFilters, type UserFilterState } from "./filter-users";
import { ResetPasswordDialog } from "./reset-password-dialog";
import { UserFormDialog } from "./user-form-dialog";
import { UsersFilters } from "./users-filters";
import { UsersTable } from "./users-table";

/**
 * User & Role Management (spec §4.13/§6) — Admin-only. Search/role/status
 * filtering happens client-side and there's no pagination: this app's
 * realistic scale is a single garage's staff roster, not hundreds of
 * accounts (see services/users/users.ts's listUsers() note).
 */
export function UsersPageClient({ initialUsers, currentUserId }: { initialUsers: ProfileRow[]; currentUserId: string }) {
  const [users, setUsers] = useState(initialUsers);
  const [filters, setFilters] = useState<UserFilterState>(DEFAULT_USER_FILTERS);

  const visibleUsers = useMemo(() => filterUsers(users, filters), [users, filters]);
  const isFiltered = hasActiveUserFilters(filters);

  const [formDialog, setFormDialog] = useState<{ open: boolean; editing: ProfileRow | null }>({
    open: false,
    editing: null,
  });
  const [passwordDialog, setPasswordDialog] = useState<{ open: boolean; user: ProfileRow | null }>({
    open: false,
    user: null,
  });
  const [statusDialog, setStatusDialog] = useState<{ open: boolean; user: ProfileRow | null }>({
    open: false,
    user: null,
  });

  function upsertUser(user: ProfileRow) {
    setUsers((prev) => (prev.some((u) => u.id === user.id) ? prev.map((u) => (u.id === user.id ? user : u)) : [...prev, user]));
  }

  async function handleToggleActive(user: ProfileRow) {
    const result = await setUserActiveAction(user.id, !user.isActive);
    if (result.success) {
      upsertUser(result.data);
      toast.success(result.data.isActive ? "User activated." : "User deactivated.");
      return { success: true };
    }
    return { success: false, error: result.error };
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-neutral-900">User &amp; Role Management</h1>
          <p className="mt-1 text-sm text-neutral-500">Create staff accounts, assign roles, and manage access.</p>
        </div>
        <Button type="button" className="rounded-[10px]" onClick={() => setFormDialog({ open: true, editing: null })}>
          <Plus className="size-4" />
          Add User
        </Button>
      </div>

      <UsersFilters
        filters={filters}
        onChange={(next) => setFilters((prev) => ({ ...prev, ...next }))}
        onReset={() => setFilters(DEFAULT_USER_FILTERS)}
      />

      <div className="rounded-[14px] border border-neutral-200 bg-white p-4 shadow-sm">
        <UsersTable
          users={visibleUsers}
          // The "last active Administrator" guardrail must count the whole
          // roster, not just what's on screen — otherwise filtering the list
          // down to one admin would wrongly disable the deactivate button.
          allUsers={users}
          isFiltered={isFiltered}
          currentUserId={currentUserId}
          onEdit={(user) => setFormDialog({ open: true, editing: user })}
          onResetPassword={(user) => setPasswordDialog({ open: true, user })}
          onToggleActive={(user) => setStatusDialog({ open: true, user })}
        />
      </div>

      <UserFormDialog
        open={formDialog.open}
        editing={formDialog.editing}
        onOpenChange={(open) => setFormDialog((prev) => ({ ...prev, open }))}
        onSaved={upsertUser}
      />

      <ResetPasswordDialog
        open={passwordDialog.open}
        user={passwordDialog.user}
        onOpenChange={(open) => setPasswordDialog((prev) => ({ ...prev, open }))}
      />

      <ConfirmUserStatusDialog
        open={statusDialog.open}
        user={statusDialog.user}
        nextActive={statusDialog.user ? !statusDialog.user.isActive : false}
        onOpenChange={(open) => setStatusDialog((prev) => ({ ...prev, open }))}
        onConfirm={handleToggleActive}
      />
    </div>
  );
}
