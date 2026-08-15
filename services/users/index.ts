/**
 * users module — User & Role Management (spec §4.13/§6). Admin-only:
 * creating/editing/deactivating staff accounts, backed by the `profiles`
 * table (0020_user_roles_profiles.sql). Called by Server Actions
 * (app/(app)/settings/users/actions.ts) via the service-role client
 * (lib/supabase/admin.ts), never straight from components.
 */
export * from "./mechanics";
export * from "./schemas";
export * from "./users";
