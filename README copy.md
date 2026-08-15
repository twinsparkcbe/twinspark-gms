# Twinspark Garage Management System

Next.js (App Router) + Supabase (Postgres + Auth) frontend/backend for the
Twinspark garage in Coimbatore. See `twinspark-style-guide.md` and the
proposal/PRD PDFs in the repo root for scope and design tokens.

## Stack

- Next.js 15 (App Router, TypeScript, Server Components + Server Actions)
- Supabase: Postgres, Auth, RLS — no separate Express server. Business logic
  lives in `services/*` and is called from Server Actions / `app/api` route
  handlers, not directly from components.
- Tailwind CSS v4 + shadcn/ui (`new-york` style), themed to
  `twinspark-style-guide.md` tokens in `app/globals.css`.

## Getting started

```bash
npm install
cp .env.example .env.local   # already filled in for this project — see below
npm run dev
```

Env vars (`.env.local`, gitignored):

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

Get these from Supabase Dashboard → Project Settings → API. Never commit the
`service_role` key or DB password to the repo.

## Folder structure

```
app/
  (auth)/login/        public login route
  (app)/                protected shell: sidebar + header + one folder per module
  auth/callback/        Supabase email-link/OAuth redirect handler
  layout.tsx, page.tsx, globals.css
components/
  ui/                   shared shadcn/ui primitives (button, input, table, dialog, badge, ...)
  layout/               sidebar, header, nav config
  shared/                cross-module composites (e.g. module-placeholder)
lib/
  supabase/              server.ts / client.ts / middleware.ts Supabase helpers
  auth/permissions.ts    role -> module access map (Admin vs Sales Person)
  utils.ts               cn() helper
services/
  <module>/              business logic per module (inventory, sales, billing, ...)
  shared/                 cross-module logic: stock.ts, invoice.ts, gst-discount.ts
supabase/
  migrations/             plain SQL migrations (Supabase CLI or Dashboard SQL editor)
types/
  database.types.ts       placeholder — regenerate via `supabase gen types` once schema exists
middleware.ts             refreshes Supabase session + redirects unauthenticated requests
```

## Module workflow

For every module (Dashboard, Inventory, Purchase, Sales, Service, Billing,
Customer & Vehicle, Online Orders, Reports, User Roles): 1) feature/use-case
list, confirmed → 2) test cases, confirmed → 3) implementation. Route folders
and `services/<module>/index.ts` are scaffolded but intentionally empty
(`ModulePlaceholder` component) until each module clears that process.

## Admin user

No `service_role` key is configured, so this scaffold can't create Supabase
Auth users programmatically. Create the admin manually in Supabase Dashboard
→ Authentication → Users, then set their role once the `profiles` table
exists (added when the User Roles module is implemented).
