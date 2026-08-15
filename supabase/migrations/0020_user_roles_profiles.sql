-- User & Role Management — spec §3.1/§4.13/§6, doc/user-roles-scope.md
-- (feature list confirmed in chat, 2026-08-03).
--
-- Replaces the `auth.users.user_metadata.role` stopgap (used since
-- 0001_inventory_schema.sql / require-admin.ts) with a real `profiles` table
-- that adds the `is_active` flag the PRD's User entity always specified but
-- nothing in the app could enforce yet (see require-admin.ts's INV-059 note).
--
-- IMPORTANT — this does NOT touch the ~11 existing migrations that gate RLS
-- policies/SECURITY DEFINER functions on `auth.jwt() -> 'user_metadata' ->>
-- 'role'` (inventory, purchases, sales, service, online orders...). Rewriting
-- every one of those to look up `profiles` instead is out of scope for this
-- pass and a much bigger blast radius than "add User Management." Instead:
-- `profiles.role` becomes the source of truth for the *app layer* (route
-- guards in lib/auth/*, the Settings/Users screen), and every role change
-- made through this module also writes `user_metadata.role` on the
-- underlying auth user (see services/users/users.ts) so the JWT — and every
-- SQL-level policy that reads it — stays correct once the session's token
-- next refreshes. `is_active` has no JWT equivalent and needs none: every
-- app-layer guard checks it with a fresh DB read on every request (via
-- lib/auth/get-session-access.ts), so deactivation takes effect immediately,
-- not on next token refresh.

-- ---------------------------------------------------------------------------
-- 1. Enum + table
-- ---------------------------------------------------------------------------

create type public.user_role as enum ('admin', 'sales_person');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role public.user_role not null default 'sales_person',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_role_idx on public.profiles (role);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Backfill — every auth user that already exists (today: just the admin
--    account used to build/demo the app so far) gets a profile row so
--    nobody is locked out the moment this migration lands. Role/name are
--    seeded from whatever's already in user_metadata; is_active defaults to
--    true (nobody existing was ever "deactivated" — that concept didn't
--    exist before this table).
-- ---------------------------------------------------------------------------

insert into public.profiles (id, full_name, role, is_active)
select
  u.id,
  coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), split_part(u.email, '@', 1)),
  coalesce((u.raw_user_meta_data ->> 'role')::public.user_role, 'sales_person'),
  true
from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Row Level Security — deliberately narrow, same "no direct write policy"
--    stance as online_orders/purchase_entries/etc. Every write (create user,
--    edit role/name, reset password, activate/deactivate) goes through the
--    service-role client in services/users/users.ts, gated by requireAdmin()
--    server-side — that client bypasses RLS entirely, so no INSERT/UPDATE/
--    DELETE policy is needed or added here.
--
--    The only policy is a self-read: every authenticated user can read their
--    OWN row (id = auth.uid()) via the normal client — this is what
--    lib/auth/get-session-access.ts uses on every request to resolve
--    role/is_active for route guards. Nobody needs to read anyone else's row
--    through this policy; the Settings/Users list page reads via the
--    service-role client instead (also bypasses RLS), so there's no
--    "admin reads all profiles" policy to write (and no recursive-policy
--    problem to worry about).
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (id = auth.uid());
