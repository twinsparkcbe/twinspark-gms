# Twinspark GMS — Vercel Deployment Guide

**Project:** `twinspark-gms` (Next.js 15.5.20, React 19, Supabase)
**Repo:** `https://github.com/trustwebfreelancing-code/twinspark-gms` (branch `main`)
**Supabase:** existing project `oxdokxoblbijghiekzcr` — reused for production
**Domain:** custom domain (steps in §6)

---

## 0. Blockers to clear before you touch Vercel

### 0.1 Your GitHub repo is stale — 217 uncommitted files

`git rev-list origin/main...main` = `0 0`, but `git status` shows 217 modified/deleted/untracked files. Vercel builds from GitHub, not your disk. **If you connect Vercel right now it will deploy a months-old version of the app.**

```bash
cd ~/my-fl-projects/twinspark-gms

# Confirm nothing secret is about to be committed
git status --short
git check-ignore -v .env.local        # must print a match

git add -A
git commit -m "Prepare production deployment"
git push origin main
```

Review `git status --short` carefully first — 217 files is a lot to push blind. In particular confirm `.env.local` does **not** appear (it's gitignored, so it shouldn't).

### 0.2 Verify the production build passes locally

Typecheck already passes (`tsc --noEmit` → exit 0, verified). Run the full build too — a build that fails locally will fail identically on Vercel, but with a slower feedback loop:

```bash
npm run build
```

Fix anything it reports before pushing. Also run `npm run lint` and `npm test` if you want the same gates your Definition of Done checklist uses.

### 0.3 Fix the 5MB upload limit — this WILL break on Vercel

Your Server Actions accept 6MB (`next.config.mjs` → `serverActions.bodySizeLimit: "6mb"`) and the client validates uploads at 5MB (`MAX_IMAGE_BYTES` in three files).

**Vercel caps serverless request bodies at 4.5MB, hard.** Requests above that are rejected at the edge with a 413 before your code runs — `bodySizeLimit` cannot raise it. Any purchase image or payment screenshot between 4.5MB and 5MB will fail in production with an opaque error, and phone-camera photos routinely land in that range.

**Recommended fix (5 minutes):** lower the client limit to 4MB in all three files, and drop `bodySizeLimit` to `"4.5mb"` so the two agree.

- `components/online-orders/public-order-form.tsx:27`
- `components/purchases/edit-item-details-dialog.tsx:43`
- `components/purchases/record-purchase-dialog.tsx:51`

```ts
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
```

Update the user-facing validation message to say 4MB too.

**Alternative (better long-term, more work):** have the browser upload straight to Supabase Storage using a signed upload URL, and pass only the resulting path through the Server Action. This bypasses Vercel's body limit entirely and takes the file bytes off your function's execution time. Not required for launch — the 4MB cap is fine for a garage's phone photos, and it's reversible.

### 0.4 Confirm all 26 migrations are applied

You're reusing the same Supabase project, so this should already be true — but confirm before the client touches it. `supabase/migrations/` runs `0001` → `0026_mechanic_access.sql`. In the Supabase dashboard → SQL Editor, spot-check that the newest ones landed (e.g. the mechanic role enum from `0025`, the sale payment status column from `0024`).

---

## 1. Create the Vercel project

1. Sign in at vercel.com with the **GitHub account that owns the repo** (`trustwebfreelancing-code`) — this makes the repo appear automatically.
2. **Add New → Project → Import** `twinspark-gms`.
3. Vercel auto-detects Next.js. Leave every build setting at its default:
   - Framework Preset: **Next.js**
   - Root Directory: `./`
   - Build Command / Output Directory / Install Command: **default**

   You do not need a `vercel.json`. Your `next.config.mjs` is already deployment-safe.
4. **Do not click Deploy yet** — add environment variables first (§2), otherwise the first build fails and you waste a cycle.

---

## 2. Environment variables

Under **Settings → Environment Variables**, add these three. Values come from your local `.env.local`.

| Name | Environments | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Production, Preview, Development | `https://oxdokxoblbijghiekzcr.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Production, Preview, Development | Safe to expose — RLS protects the data |
| `SUPABASE_SERVICE_ROLE_KEY` | **Production only** | Mark as **Sensitive**. Bypasses RLS entirely |

Two things that matter here:

- **Scope `SUPABASE_SERVICE_ROLE_KEY` to Production only.** Preview deployments are built from every branch and PR; anything with a preview URL can hit that key. Your `lib/supabase/admin.ts` is the only consumer, and it's server-only, but limiting blast radius costs nothing. If you later want the User Roles module working on previews, add it to Preview then — deliberately.
- **Mark it Sensitive** so it can't be read back out of the Vercel dashboard after saving.

Fastest way to get the values across without retyping:

```bash
npm i -g vercel
vercel link          # pick the project you just created
vercel env pull      # confirms what's set, writes .env.vercel.local
```

---

## 3. Set the Node.js version

**Settings → General → Node.js Version → 22.x**

You're on Node v22.22.3 locally. Matching majors avoids a class of "works on my machine" build failures — Next 15 and React 19 are both sensitive to this.

---

## 4. Set the deployment region

**Settings → Functions → Function Region → Mumbai (bom1)**

The client is in Coimbatore and your Supabase project should be in an India/Singapore region. Every page in this app is dynamic (Supabase auth cookies via `middleware.ts`), so every request makes a round trip from the function to Postgres. Leaving the default US region adds ~250ms to *every* page load. This one setting is the single biggest perceived-speed win.

Check your Supabase project's region (Dashboard → Project Settings → General) and pick the nearest Vercel region to it.

---

## 5. First deploy

Click **Deploy**. Watch the build log. Expect 2–4 minutes.

If it fails, the log tells you where. The usual culprits at this stage: a missing env var (§2), or an ESLint/type error in code you hadn't built since editing.

When it succeeds you'll get `twinspark-gms-<hash>.vercel.app`. **Don't test login yet** — auth will fail until §7.

---

## 6. Custom domain

**Settings → Domains → Add**, enter the domain (e.g. `gms.twinspark.in`).

Vercel then shows you the exact DNS record to create at your registrar:

| Domain type | Record | Name | Value |
|---|---|---|---|
| Subdomain (`gms.example.com`) | `CNAME` | `gms` | `cname.vercel-dns.com` |
| Apex / root (`example.com`) | `A` | `@` | `76.76.21.21` |

**Use a subdomain if you can** — CNAMEs propagate faster, survive Vercel changing IPs, and don't fight with the client's existing email/website records on the apex.

Add the record at the registrar, then wait. Propagation is usually minutes but the TTL can stretch it to a few hours. Vercel provisions the SSL certificate automatically once DNS resolves — you don't do anything for HTTPS.

Verify:
```bash
dig gms.twinspark.in CNAME +short
```

Then set it as the **Primary Domain** in Vercel so the `.vercel.app` URL redirects to it.

---

## 7. Update Supabase auth URLs — login breaks without this

This is the step people skip and then spend an hour debugging. Supabase rejects any auth redirect to a URL not on its allow-list, so your production login will silently fail until you do this.

**Supabase Dashboard → Authentication → URL Configuration:**

**Site URL:**
```
https://gms.twinspark.in
```

**Redirect URLs** (add all of these):
```
https://gms.twinspark.in/**
https://twinspark-gms.vercel.app/**
https://twinspark-gms-*-trustwebfreelancing-code.vercel.app/**
http://localhost:3000/**
```

The third line is the wildcard for preview deployments — without it, logging into a preview build fails. Copy the exact preview-URL pattern from any preview deployment Vercel has created. Keep `localhost:3000` so your local dev keeps working.

Your `app/auth/callback/route.ts` derives its redirect from `new URL(request.url).origin`, so it adapts to whichever host serves the request automatically — no code change needed. The allow-list is the only thing gating it.

**Also check Supabase Storage:** the app uses two buckets (images, payment screenshots). Since you're reusing the same project, the buckets and their policies carry over unchanged. If image loading fails in production, check the bucket's public/signed-URL settings rather than anything on Vercel.

---

## 8. Post-deploy verification

Run through this on the live domain, logged in as Admin:

- [ ] Login works; wrong password shows the right error
- [ ] Role routing — Sales Person lands correctly and **cannot** reach Inventory, Purchases, Reports, Dashboard, Settings (verify by typing the URL directly, not just checking the nav)
- [ ] Dashboard loads with real figures
- [ ] Record a purchase **with an image attached** — this exercises the §0.3 fix
- [ ] Stock auto-increased after that purchase
- [ ] Create a sale → fitting charges appear, stock decreased
- [ ] Create a service job → labour charges appear, no fitting charges
- [ ] Invoice generates and prints correctly
- [ ] Public online-order form submits with a payment screenshot
- [ ] Reports export to Excel (`xlsx` runs server-side — worth confirming under Vercel's function limits)
- [ ] Test on the client's actual phone, on mobile data

**Rolling back:** Vercel Deployments tab → pick the last good deployment → **Promote to Production**. Instant, no rebuild. Good to know before you need it.

---

## 9. Ongoing workflow

Once connected, every `git push origin main` deploys to production automatically. Every other branch gets a preview URL.

Suggested habit for client work:

```bash
git checkout -b feature/xyz
# ...work, commit...
git push origin feature/xyz     # → preview URL, send to client for review
# merge to main when approved   → production
```

**Enable Deployment Protection** (Settings → Deployment Protection → Vercel Authentication) for Preview environments, so half-finished work isn't publicly reachable at a guessable URL.

---

## Cost note

Vercel Hobby is free but its terms prohibit commercial use — a paid client project technically requires **Pro ($20/mo)**. Worth raising with the client, or factoring into your invoice, before the site is live and depended on. Hobby also has lower function timeouts, which the Reports/Excel export is the most likely feature to hit.
