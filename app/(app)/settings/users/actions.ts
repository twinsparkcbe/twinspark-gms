"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createUser,
  listUsers,
  resetUserPassword,
  setUserActive,
  updateUser,
  type CreateUserInput,
  type ProfileRow,
  type UpdateUserInput,
} from "@/services/users";

type ActionResult<T = undefined> = { success: true; data: T } | { success: false; error: string };

function toErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** Every action re-checks access server-side — never trust the client. User
 * & Role Management is Administrator-only, no exceptions (spec §4.13/§6). */
async function usersAdminClient() {
  const { userId } = await requireAdmin();
  return { adminClient: createAdminClient(), currentUserId: userId };
}

function revalidateUsers() {
  revalidatePath("/settings/users");
}

export async function fetchUsersAction(): Promise<ActionResult<ProfileRow[]>> {
  try {
    const { adminClient } = await usersAdminClient();
    const data = await listUsers(adminClient);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to load users.") };
  }
}

export async function createUserAction(input: CreateUserInput): Promise<ActionResult<ProfileRow>> {
  try {
    const { adminClient } = await usersAdminClient();
    const data = await createUser(adminClient, input);
    revalidateUsers();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to create user.") };
  }
}

export async function updateUserAction(id: string, input: UpdateUserInput): Promise<ActionResult<ProfileRow>> {
  try {
    const { adminClient } = await usersAdminClient();
    const data = await updateUser(adminClient, id, input);
    revalidateUsers();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to update user.") };
  }
}

export async function resetUserPasswordAction(id: string, password: string): Promise<ActionResult<undefined>> {
  try {
    const { adminClient } = await usersAdminClient();
    await resetUserPassword(adminClient, id, { password });
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to reset password.") };
  }
}

export async function setUserActiveAction(id: string, isActive: boolean): Promise<ActionResult<ProfileRow>> {
  try {
    const { adminClient, currentUserId } = await usersAdminClient();
    const data = await setUserActive(adminClient, currentUserId, id, isActive);
    revalidateUsers();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: toErrorMessage(err, "Failed to update user status.") };
  }
}
