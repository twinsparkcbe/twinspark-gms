-- Mechanic role (doc/mechanic-role-scope.md) — enum value only.
--
-- Deliberately its own migration: `alter type ... add value` cannot be used
-- in the same transaction that later references the new literal, and Supabase
-- runs each migration file in one transaction. 0026_mechanic_access.sql does
-- everything else.

alter type public.user_role add value if not exists 'mechanic';
