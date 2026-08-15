# Supabase migrations

Plain SQL migrations, run via the Supabase CLI (`supabase db push`) or pasted
into the Supabase Dashboard SQL editor. No ORM, no DB password required in
the app itself — the app only ever talks to Supabase via the anon/publishable
key + RLS policies.

## Naming convention

`supabase/migrations/<timestamp>_<description>.sql`, e.g.:

```
0001_profiles_and_roles.sql
0002_inventory_items.sql
0003_purchases.sql
```

## Order of operations

This folder is intentionally empty. Per project workflow, a module's schema
(including the `profiles`/role table backing User Roles) is written only
after that module's feature list and test cases are confirmed — add
migrations module-by-module as each is signed off, not ahead of it.
