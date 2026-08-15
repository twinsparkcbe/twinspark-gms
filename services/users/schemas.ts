import { z } from "zod";

// Order here is the order the role dropdown renders in.
export const USER_ROLES = ["admin", "sales_person", "mechanic"] as const;

// Minimum password strength enforced by the app itself, independent of
// whatever the Supabase project's own auth password policy is set to — a
// garage staff account shouldn't be creatable with a 4-character password
// even if the project-level setting would technically allow it.
const passwordSchema = z.string().min(8, "Password must be at least 8 characters");

export const createUserInputSchema = z.object({
  fullName: z.string().trim().min(1, "Name is required").max(150),
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email"),
  password: passwordSchema,
  role: z.enum(USER_ROLES),
});

export type CreateUserInput = z.infer<typeof createUserInputSchema>;

// Name + role only — email is immutable here (changing it needs Supabase's
// email-change/re-verification flow, out of scope for this pass; delete +
// recreate the account if a mistake is made) and password reset is its own
// explicit action, not bundled into a general edit.
export const updateUserInputSchema = z.object({
  fullName: z.string().trim().min(1, "Name is required").max(150),
  role: z.enum(USER_ROLES),
});

export type UpdateUserInput = z.infer<typeof updateUserInputSchema>;

export const resetPasswordInputSchema = z.object({
  password: passwordSchema,
});

export type ResetPasswordInput = z.infer<typeof resetPasswordInputSchema>;
