import type { UserRole } from "@/lib/auth/permissions";
import type { ProfileRow } from "@/services/users";

/**
 * What the Add/Edit User dialog's fields should hold the moment it opens.
 *
 * Pulled out of the dialog as a pure function so it can be unit tested —
 * Vitest runs in a `node` environment with no React testing library, the
 * same reason components/shared/payment-chip.ts and
 * components/service/service-filter-state.ts exist.
 *
 * It exists at all because the dialog used to seed its state with
 * `useState(editing?.role ?? "sales_person")`. That initialiser runs once,
 * on the component's first mount, and UserFormDialog is mounted by the users
 * page for the whole life of the screen — so the second user you opened
 * still showed the first one's role, and Add User still showed the last
 * edited email. Worse, Full Name was an uncontrolled input seeded with
 * `defaultValue`: the box showed the right name while the state behind it
 * held the previous user's, so saving without retyping the name saved the
 * WRONG NAME onto the account.
 */
export interface UserFormState {
  fullName: string;
  email: string;
  password: string;
  role: UserRole;
}

/** New accounts start as the least-privileged role on purpose — granting
 * admin has to be a deliberate choice, never the default that survives
 * because nobody touched the dropdown. */
export const DEFAULT_NEW_USER_ROLE: UserRole = "sales_person";

export function initialUserFormState(editing: ProfileRow | null): UserFormState {
  return {
    fullName: editing?.fullName ?? "",
    email: editing?.email ?? "",
    // Never carried over: editing an account cannot change its password (that
    // is ResetPasswordDialog's job), and a create form must start empty.
    password: "",
    role: editing?.role ?? DEFAULT_NEW_USER_ROLE,
  };
}
