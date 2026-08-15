import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";
import type { UserRole } from "@/lib/auth/permissions";

import {
  createUserInputSchema,
  resetPasswordInputSchema,
  updateUserInputSchema,
  type CreateUserInput,
  type ResetPasswordInput,
  type UpdateUserInput,
} from "./schemas";

export class DuplicateEmailError extends Error {
  constructor() {
    super("A user with this email already exists.");
    this.name = "DuplicateEmailError";
  }
}

export class UserNotFoundError extends Error {
  constructor() {
    super("User not found.");
    this.name = "UserNotFoundError";
  }
}

export class SelfDeactivationError extends Error {
  constructor() {
    super("You cannot deactivate your own account.");
    this.name = "SelfDeactivationError";
  }
}

export class LastAdminError extends Error {
  constructor() {
    super("Cannot deactivate the last active Administrator — at least one active Admin account must remain.");
    this.name = "LastAdminError";
  }
}

export interface ProfileRow {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

type ProfileTableRow = Database["public"]["Tables"]["profiles"]["Row"];

function mapProfileRow(authUser: Pick<User, "id" | "email">, profile: ProfileTableRow): ProfileRow {
  return {
    id: profile.id,
    email: authUser.email ?? "",
    fullName: profile.full_name,
    role: profile.role,
    isActive: profile.is_active,
    createdAt: profile.created_at,
    updatedAt: profile.updated_at,
  };
}

// Supabase's admin.createUser/updateUserById surface a duplicate email as an
// AuthApiError with code "email_exists" (or, on older project configs, a
// message containing "already been registered") — normalize both into one
// clean, user-facing error rather than leaking the raw Auth API message.
function isDuplicateEmailError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? (err as { code?: unknown }).code : undefined;
  if (code === "email_exists") return true;
  const message = "message" in err ? String((err as { message?: unknown }).message ?? "") : "";
  return /already\s+(been\s+)?registered|already exists/i.test(message);
}

function toErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * All reads/writes in this module go through the service-role client
 * (services/users — Admin-only, gated by requireAdmin() in
 * app/(app)/settings/users/actions.ts) rather than needing a broad "admin
 * reads all profiles" RLS policy — see 0020_user_roles_profiles.sql §3.
 *
 * `adminClient.auth.admin.listUsers()` is the only way to read email
 * addresses (they live in `auth.users`, which PostgREST doesn't expose) —
 * `perPage: 200` covers this app's realistic scale (a single garage's
 * staff) with one call; revisit with real pagination if that ever stops
 * being true.
 */
export async function listUsers(adminClient: SupabaseClient<Database>): Promise<ProfileRow[]> {
  const [{ data: userList, error: userErr }, { data: profiles, error: profileErr }] = await Promise.all([
    adminClient.auth.admin.listUsers({ page: 1, perPage: 200 }),
    adminClient.from("profiles").select("*"),
  ]);

  if (userErr) throw new Error(toErrorMessage(userErr, "Failed to load users."));
  if (profileErr) throw new Error(toErrorMessage(profileErr, "Failed to load users."));

  const usersById = new Map(userList.users.map((u) => [u.id, u]));

  return (profiles ?? [])
    .filter((profile) => usersById.has(profile.id))
    .map((profile) => mapProfileRow(usersById.get(profile.id)!, profile))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Creates both the `auth.users` row (via the Admin API — sets the password
 * directly, no invite email) and its matching `profiles` row. If the
 * `profiles` insert fails after the auth user was created, the auth user is
 * deleted again so a failed create never leaves an orphaned login with no
 * role/active status attached to it.
 */
export async function createUser(adminClient: SupabaseClient<Database>, rawInput: CreateUserInput): Promise<ProfileRow> {
  const input = createUserInputSchema.parse(rawInput);

  const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true, // no email-delivery flow exists (out of scope) — the account must be usable immediately
    user_metadata: { full_name: input.fullName, role: input.role },
  });

  if (createErr || !created.user) {
    if (isDuplicateEmailError(createErr)) throw new DuplicateEmailError();
    throw new Error(toErrorMessage(createErr, "Failed to create user."));
  }

  const authUser = created.user;

  const { data: profile, error: profileErr } = await adminClient
    .from("profiles")
    .insert({ id: authUser.id, full_name: input.fullName, role: input.role, is_active: true })
    .select("*")
    .single();

  if (profileErr || !profile) {
    // Rollback — don't leave a login with no profile row behind.
    await adminClient.auth.admin.deleteUser(authUser.id);
    throw new Error(toErrorMessage(profileErr, "Failed to create user."));
  }

  return mapProfileRow(authUser, profile);
}

/**
 * Updates name/role in `profiles`. Also syncs `user_metadata.role` on the
 * underlying auth user so the session's JWT — which every pre-existing
 * SQL-level RLS policy across the app reads role from — is correct again
 * once that session's token next refreshes (see 0020_user_roles_profiles.sql
 * header comment). `is_active` is untouched here — that's setUserActive()'s
 * job, kept separate since it carries its own guardrails.
 */
export async function updateUser(adminClient: SupabaseClient<Database>, id: string, rawInput: UpdateUserInput): Promise<ProfileRow> {
  const input = updateUserInputSchema.parse(rawInput);

  // Demoting the last active Admin locks everyone out of Settings just as
  // effectively as deactivating them — setUserActive() has always guarded
  // that, this path didn't. It only became reachable in practice with a
  // third role to demote *to* (0026 — Mechanic).
  if (input.role !== "admin") {
    await assertNotLastActiveAdmin(adminClient, id, "Failed to update user.");
  }

  const { data: profile, error: profileErr } = await adminClient
    .from("profiles")
    .update({ full_name: input.fullName, role: input.role })
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (profileErr) throw new Error(toErrorMessage(profileErr, "Failed to update user."));
  if (!profile) throw new UserNotFoundError();

  const { error: metaErr } = await adminClient.auth.admin.updateUserById(id, {
    user_metadata: { full_name: input.fullName, role: input.role },
  });
  if (metaErr) throw new Error(toErrorMessage(metaErr, "Failed to update user."));

  const { data: authData, error: authErr } = await adminClient.auth.admin.getUserById(id);
  if (authErr || !authData.user) throw new UserNotFoundError();

  return mapProfileRow(authData.user, profile);
}

export async function resetUserPassword(adminClient: SupabaseClient<Database>, id: string, rawInput: ResetPasswordInput): Promise<void> {
  const { password } = resetPasswordInputSchema.parse(rawInput);
  const { error } = await adminClient.auth.admin.updateUserById(id, { password });
  if (error) throw new Error(toErrorMessage(error, "Failed to reset password."));
}

/**
 * Activate/deactivate. Two guardrails, both non-negotiable per the confirmed
 * feature list:
 *  - an admin can never deactivate their own account (a locked-out admin has
 *    no way back in without direct DB access)
 *  - the last remaining active admin can never be deactivated, even by
 *    another admin — the system would have no one left who can manage users
 */
/**
 * Throws LastAdminError if `targetUserId` is currently the only *active*
 * Administrator. Shared by deactivation and role demotion — the two ways to
 * lose the last Admin. A target that isn't an Admin at all is a no-op.
 */
async function assertNotLastActiveAdmin(
  adminClient: SupabaseClient<Database>,
  targetUserId: string,
  errorFallback: string
): Promise<void> {
  const { data: target, error: targetErr } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", targetUserId)
    .maybeSingle();
  if (targetErr) throw new Error(toErrorMessage(targetErr, errorFallback));
  if (!target) throw new UserNotFoundError();
  if (target.role !== "admin") return;

  const { count, error: countErr } = await adminClient
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin")
    .eq("is_active", true)
    .neq("id", targetUserId);
  if (countErr) throw new Error(toErrorMessage(countErr, errorFallback));
  if (!count || count === 0) throw new LastAdminError();
}

export async function setUserActive(
  adminClient: SupabaseClient<Database>,
  currentUserId: string,
  targetUserId: string,
  isActive: boolean
): Promise<ProfileRow> {
  if (!isActive) {
    if (targetUserId === currentUserId) throw new SelfDeactivationError();

    await assertNotLastActiveAdmin(adminClient, targetUserId, "Failed to update user status.");
  }

  const { data: profile, error: profileErr } = await adminClient
    .from("profiles")
    .update({ is_active: isActive })
    .eq("id", targetUserId)
    .select("*")
    .maybeSingle();

  if (profileErr) throw new Error(toErrorMessage(profileErr, "Failed to update user status."));
  if (!profile) throw new UserNotFoundError();

  const { data: authData, error: authErr } = await adminClient.auth.admin.getUserById(targetUserId);
  if (authErr || !authData.user) throw new UserNotFoundError();

  return mapProfileRow(authData.user, profile);
}
