# Twinspark Garage Management System — UI Style Guide

**Design Philosophy:** Modern Enterprise SaaS (Linear, Stripe Dashboard, Vercel Dashboard, Zoho Inventory, ERPNext, Notion)
Focus: speed, clarity, ease of use. Desktop-first, tablet-secondary.

---

## 1. Brand Colors (from logo)

The logo is black, red, gold and white — used sparingly as brand accents, not as the app's dominant palette.

| Token | Hex | Usage |
|---|---|---|
| `brand-black` | `#0B0B0B` | Sidebar background, header text, logo mark |
| `brand-red` | `#C1272D` | Primary actions, active nav item, key CTAs, brand highlights |
| `brand-red-dark` | `#8F1C21` | Hover/pressed state for brand-red elements |
| `brand-gold` | `#E4B343` | Rare accents only — premium badges, star ratings, small highlights |
| `brand-white` | `#FFFFFF` | Base background, card surfaces |

**Rule:** Brand colors mark identity (logo, sidebar, primary buttons). They are not used for status — status uses the semantic palette below, so a red button and a red "danger" state never get confused.

---

## 2. Semantic Colors (status & feedback)

| Token | Hex | Usage |
|---|---|---|
| `success` | `#16A34A` | Completed, in stock, paid, dispatched |
| `warning` | `#F59E0B` | Low stock, pending approval, due soon |
| `danger` | `#DC2626` | Errors, delete actions, out of stock, overdue |
| `info` | `#2563EB` | Neutral informational badges/links |

**Rule:** Never repurpose `brand-red` for error states in tables/badges — use `danger` (`#DC2626`) so brand identity and system status stay visually distinct.

---

## 3. Neutrals

| Token | Hex | Usage |
|---|---|---|
| `neutral-0` | `#FFFFFF` | Page/card background |
| `neutral-50` | `#F8F9FA` | App background behind cards |
| `neutral-100` | `#F1F3F5` | Table row hover, subtle dividers |
| `neutral-200` | `#E5E7EB` | Borders, input outlines |
| `neutral-400` | `#9CA3AF` | Placeholder text, disabled state |
| `neutral-600` | `#4B5563` | Secondary text |
| `neutral-900` | `#111827` | Primary text |

---

## 4. Typography

- **Font:** Inter (fallback: Geist, system-ui)
- **Scale:**
  | Style | Size | Weight |
  |---|---|---|
  | Page title (H1) | 24px | 600 |
  | Section title (H2) | 18px | 600 |
  | Card label | 13px | 500 (uppercase, neutral-600) |
  | Card metric value | 28px | 700 |
  | Body | 14px | 400 |
  | Table header | 12px | 600 (uppercase, neutral-600) |
  | Caption/helper | 12px | 400 (neutral-400) |

---

## 5. Spacing & Layout

- **Base unit:** 8px grid (4px used only for icon/text micro-gaps)
- **Page padding:** 24px (desktop), 16px (tablet)
- **Card padding:** 20px
- **Gap between cards:** 16–24px
- **Sidebar width:** 240px, sticky, `brand-black` background with white/gray text, `brand-red` for active item indicator (left border or filled pill)
- **Table:** sticky header, 12px vertical row padding, row hover = `neutral-100`

---

## 6. Shape & Elevation

| Element | Radius | Shadow |
|---|---|---|
| Cards | 12px | `0 1px 3px rgba(0,0,0,0.08)` |
| Buttons | 8px | none (flat), subtle shadow on hover only |
| Inputs | 8px | none, `neutral-200` border, `brand-red` border on focus |
| Modals | 12px | `0 8px 24px rgba(0,0,0,0.12)` |
| Badges/chips | 999px (pill) | none |

No glassmorphism, no gradients, no neon. Flat surfaces with soft shadows only.

---

## 7. Components

**Buttons**
- Primary: `brand-red` bg, white text, hover → `brand-red-dark`
- Secondary: white bg, `neutral-200` border, `neutral-900` text
- Danger: `danger` bg, white text (destructive actions only — delete, cancel order)
- Ghost: transparent bg, `neutral-600` text, hover → `neutral-100` bg

**Status badges** (pill, 12px text, colored bg at 10–15% opacity + colored text)
- In Stock → `success`
- Low Stock → `warning`
- Out of Stock → `danger`
- Pending / Dispatched / Paid → matched to semantic meaning above

**Cards (Dashboard metrics)**
- Label (uppercase, small, neutral-600) → big metric value → optional trend/subtext
- One accent icon per card (Lucide), colored per metric type, not decorative

**Tables**
- Sticky header, sortable columns, row-level quick actions (icon buttons, right-aligned)
- Search + filter chips row directly above table
- Pagination bottom-right

**Feedback**
- Toast notifications: top-right, auto-dismiss, colored left border matching semantic type
- Confirmation dialogs: for destructive actions only (delete, cancel), `danger` primary button
- Loading skeletons: `neutral-100` shimmer blocks, match final content shape

---

## 8. Icons

- **Set:** Lucide Icons only (consistent stroke width: 1.5–2px)
- Icons are functional, not decorative — every icon should reduce ambiguity (e.g. search, filter, low-stock warning), never used purely for visual filler

---

## 9. Do / Don't

**Do**
- ✅ White backgrounds, generous whitespace
- ✅ Flat cards with soft shadows
- ✅ Brand red reserved for identity + primary actions
- ✅ Consistent 8px spacing rhythm across all modules

**Don't**
- ❌ Heavy glassmorphism or blur effects
- ❌ Gradients or neon accents
- ❌ Using brand red for error/danger states
- ❌ Busy backgrounds or decorative textures
- ❌ More than one accent color per component

---

## 10. Reference Products

Linear · Stripe Dashboard · Vercel Dashboard · Zoho Inventory · ERPNext · Notion (spacing/simplicity reference only — not visual style)

---

## 11. v1.1 Update — Shell & Auth Patterns (Twin Spark logo reference)

Confirmed against the client's logo (`public/twinspark-logo.jpg`, black/red/gold shield) and a reference dashboard/login mockup. Refines, not replaces, sections 1–10.

**Radius:** base `--radius` bumped from 8px to **10px** — applies to buttons, inputs, and the default card radius token (cards keep their explicit 12px where set directly).

**Sidebar**
- Logo lockup at the top: `BrandMark` (logo in a white chip, since the source file is a flat-background .jpg) + two-line text — bold app name, small uppercase brand-red subtitle underneath.
- Active nav item is a **solid filled `brand-red` pill** (white text/icon), not a left-border indicator.
- Footer (pinned to bottom, not in the topbar): a bordered account card — avatar circle (brand-red bg, white initials) + name + uppercase role caption — followed by a full-width "Sign Out Session" button (ghost style, turns danger-colored on hover).

**Topbar**
- No avatar/user menu here anymore (moved to sidebar footer). Left side is a breadcrumb: `TWINSPARK WORKSPACE / SECTION NAME`. Right side is a live status readout: `SYSTEM TIME UTC: <date>` next to a small pulsing `success`-colored dot.

**Login page**
- Centered column, `neutral-50` background, `BrandMark` (logo variant) with a soft `brand-red/25` blurred glow behind it, app name (H1) + one-line tagline underneath.
- Form fields have a leading Lucide icon (Mail / Lock) inside the input, uppercase small field labels, and the password field has a show/hide (Eye/EyeOff) toggle.
- Primary CTA is full-width, `size="lg"`, labelled to the destination (e.g. "Sign In to Portal") rather than a generic "Sign in".

**Component note:** icon-prefixed inputs are composed at the call site (relative wrapper + absolutely positioned icon around the shared `Input`), not a new form primitive — keep doing it this way for future icon/search inputs rather than forking `Input`.

---

## 12. v1.2 Update — Approved POC Design System (Slate/Rose)

This is the design system actually used in the client-approved POC. It **supersedes the hex values in §1–3 and §6** (same component structure/rules from §5, §7, §9 still apply — only the palette, shadow scale, and a few typography weights change). All tokens below are implemented as CSS variables in `app/globals.css` under the same names used since v1 (`brand-red`, `neutral-*`, `success`, etc.) — component code should keep referencing those names, not hand-picked hex values.

**1. Color palette**

| Token | Old (v1) | New (v1.2) | Tailwind equivalent |
|---|---|---|---|
| `brand-red` (primary CTA/active state) | `#C1272D` | `#e11d48` | `rose-600` |
| `brand-red-dark` (hover/pressed) | `#8F1C21` | `#be123c` | `rose-700` |
| `brand-black` (sidebar) | `#0B0B0B` | `#020617` | `slate-950` |
| `brand-black-soft` (secondary dark surface — new) | — | `#0f172a` | `slate-900` |
| `success` (cash channel) | `#16A34A` | `#059669` | `emerald-600` |
| `success-bg` (new) | — | `#ecfdf5` | `emerald-50` |
| `info` (UPI channel / pending) | `#2563EB` | `#1d4ed8` | `blue-700` |
| `info-bg` (new) | — | `#eff6ff` | `blue-50` |
| `warning` (alerts — solid, no tint) | `#F59E0B` | `#f97316` | `orange-500` |
| `danger` | `#DC2626` | `#DC2626` (unchanged) | `red-600` |
| `danger-bg` (new) | — | `#fef2f2` | `red-50` |
| `channel-purple` (card payment channel — new) | — | `#7e22ce` | `purple-700` |
| `channel-purple-bg` (new) | — | `#faf5ff` | `purple-50` |
| `neutral-*` | custom gray hexes | exact Tailwind **slate** scale (50/100/200/400/500/600/900) | `slate-50…slate-900` |

Deliberate judgment call: `danger` stays a distinct red (`red-600`), not `rose-600`, so brand identity and error states still never get confused — this preserves the original §2 rule even though the brand color itself changed.

Payment-channel color reuse: `success` = Cash, `info` = UPI, `channel-purple` = Card. Use the `Badge` `channel` variant for the purple one; `success`/`info` variants double as channel badges.

**Topbar stays white** (confirmed): the "header elements" using slate-900/950 in the approved spec refers to the sidebar and any dark content surfaces (e.g. a future dashboard hero banner), not the persistent topbar — the breadcrumb + system-status bar keeps its white background per the reference screenshot.

**2. Elevation & shadows** — use Tailwind's native shadow utilities directly, not custom rgba box-shadows:
- Small depth (interactive grid/catalog items): `shadow-2xs` / `shadow-xs`
- Medium depth (persistent cards, dashboard metric grids): `shadow-sm`
- High depth (modals, popups, printable overlays): `shadow-2xl`

**3. Spacing & layout rhythm**
- Page padding: `p-4` (mobile) → `sm:p-6` (tablet) → `lg:p-8` (widescreen), content capped at `max-w-7xl mx-auto`.
- Section spacing: `space-y-4` / `space-y-6`. Grid gaps: `gap-5` / `gap-6`. Modal/dialog form fields: `space-y-3` / `space-y-3.5`.
- Touch targets: interactive buttons (checkout, stock adjust, quick actions) use `py-2 px-3` up to `py-3 px-4` to stay comfortably above 44px on mobile.

**4. Typography**
- Primary headers/titles (`CardTitle`, `DialogTitle`, page H1s): `font-black tracking-tight text-neutral-900` (was `font-semibold`).
- Technical/status data — SKUs, invoice serial codes, system time, currency amounts: `font-mono text-[11px] font-bold text-neutral-500`. Applied now to the topbar's `SYSTEM TIME UTC` readout; use the same treatment for any SKU/invoice-code/amount display built in later modules.
- Plain grayscale text/border shades (not brand or status colors) may use Tailwind's native `slate-*` utilities directly at the call site — only brand/status colors must go through the named tokens above.

---

## 13. Sidebar Chrome — Scoped Glassmorphism/Gradient Exception

The §9 "Do/Don't" rule (no glassmorphism, no gradients) and the §12 POC spec's "stays clean and flat... rather than heavy visual gradients" line **still govern all POS/data content** — cards, tables, forms, invoices, dashboards. That spec itself explicitly allows "subtle alpha-transparency backdrops (e.g. `bg-rose-50/10`, `bg-slate-900/60 backdrop-blur-xs`)" for chrome elements like modals. The persistent sidebar (`components/layout/sidebar.tsx`) uses that same allowance, scoped to nav chrome only:

- Sidebar background: subtle `slate-950 → slate-900` vertical gradient (`brand-black` → `brand-black-soft`), not flat.
- Active nav item: animated gradient pill (`brand-red → brand-red-dark`) with a soft glow shadow and a glowing left accent bar — animated between selections via Framer Motion `layoutId` (spring, ~150–250ms, no bounce overkill).
- Icon containers: every nav icon sits in its own `rounded-lg` bordered chip (`bg-white/5` idle → `bg-white/10` hover → `bg-white/15` active), not a bare icon.
- Account card: `backdrop-blur-md` + `bg-white/5` + `border-white/10` — genuine glassmorphism, restrained to one element.
- Dividers: gradient-fade hairlines (`via-white/10`) instead of solid borders, for a less "boxed" feel.

**Why scoped this way:** garage staff use this all day — motion/blur stays fast and minimal (short spring durations, one blur surface, no animated backgrounds), and the rule change only touches navigation chrome, not the data-dense screens where flat/legible/scannable still matters most (per §12's "professional corporate POS feel" and §9's original reasoning). If a future request asks to extend gradients/blur into cards or tables, flag it as a bigger scope change before doing it — don't assume this section covers it.

**Accessibility:** nav links use `aria-current="page"` on the active item, visible `focus-visible` rings (not just hover states), and text opacity kept ≥65% against `slate-950` for contrast. Respect `prefers-reduced-motion` if adding further motion — keep durations short regardless.
