# Virelsy - Dating, designed with intention

A production-grade premium dating SaaS platform. Verified profiles, honest
intentions, premium experience. Built mobile-first with a custom design system.

## Stack

| Layer      | Choice                                                        |
| ---------- | ------------------------------------------------------------- |
| Framework  | Next.js 16 (App Router, Server Components first, Turbopack)   |
| Language   | TypeScript (strict)                                           |
| Styling    | Tailwind CSS v4 + custom design tokens                        |
| Components | shadcn/ui (30+ primitives) + bespoke app components           |
| Motion     | Motion (Framer Motion successor) - springs, 60fps transforms  |
| Database   | PostgreSQL (Supabase-compatible) via Prisma 7                 |
| Auth       | Auth.js v5 - email/password, Google, Apple, JWT sessions      |
| Validation | Zod on every API boundary                                     |
| Payments   | Stripe-first webhook architecture (Revolut-ready)             |
| Email      | Provider-agnostic mailer (Resend-ready, console in dev)       |

## Quick start

```bash
# 1. Install
npm install

# 2. Environment
cp .env.example .env
npx auth secret          # paste into AUTH_SECRET
# point DATABASE_URL / DIRECT_URL at PostgreSQL (local or Supabase)

# 3. Database
npx prisma migrate dev --name init
npx prisma db seed       # interests + admin + demo profiles

# 4. Run
npm run dev              # http://localhost:3000
```

**Seeded accounts** (dev only - change immediately in any shared environment):

- Admin: `admin@virelsy.app` / `admin-virelsy-2026` → `/admin`
- Demo members: `saoirse@demo.virelsy.app` (and 5 more) / `demo-virelsy-2026`

## Scripts

| Command                 | What it does                          |
| ----------------------- | ------------------------------------- |
| `npm run dev`           | Dev server (Turbopack)                |
| `npm run build`         | Production build                      |
| `npm start`             | Serve the production build            |
| `npm run lint`          | ESLint                                |
| `npx prisma studio`     | Browse the database                   |
| `npx prisma migrate dev`| Create/apply migrations               |
| `npx prisma db seed`    | Seed catalogue + demo data            |

## Architecture

```
src/
├── app/
│   ├── (marketing)/         # Landing, pricing, safety, legal - static, SEO-first
│   ├── (auth)/              # Login, register, forgot/reset password, verify email
│   ├── (app)/               # Authenticated app: discover, matches, chat, profile, settings
│   ├── onboarding/          # 6-step profile wizard (own shell, pre-app)
│   ├── admin/               # RBAC-gated admin panel (dashboard, users, reports, …)
│   └── api/                 # Route handlers - thin controllers over services
├── components/
│   ├── ui/                  # shadcn/ui design-system primitives
│   ├── shared/              # Logo, badges, empty states, page headers
│   ├── app/                 # Swipe deck, chat thread, nav, settings forms
│   ├── auth/ · marketing/ · onboarding/
├── lib/
│   ├── auth.ts / auth.config.ts   # Auth.js v5 (edge-safe split)
│   ├── db.ts                # Prisma singleton (pg driver adapter)
│   ├── api.ts               # Response envelope + guards (session, RBAC, rate limit)
│   ├── rbac.ts              # Explicit permission → role matrix
│   ├── rate-limit.ts        # Sliding window (memory now, Redis-swappable)
│   ├── tokens.ts            # Hashed one-time tokens (email, reset, OTP)
│   ├── audit.ts             # Append-only audit trail
│   ├── validators/          # Zod schemas - single source of validation truth
│   └── services/            # Domain logic: discovery, matching, chat, profile
├── middleware.ts            # Session gating for app/admin routes
└── generated/prisma/        # Generated Prisma client (do not edit)
```

**Conventions**

- Every API response is `{ data }` or `{ error: { code, message, fields? } }`.
- Services own domain logic; route handlers stay thin.
- All user input crosses a Zod schema before touching the database.
- Privileged actions write to the audit log.
- Colors/typography/radius come from tokens in `globals.css` - no raw hex in components.

## Design system

Brand: rose `#E11D48` on warm neutrals, 20px+ radius, Inter (body) + Playfair Display
(display), minimal soft shadows, glass surfaces for bars only. Dark mode via `.dark` tokens.
Built with guidance from the bundled **UI/UX Pro Max** skill (`.claude/skills/ui-ux-pro-max`).

## Safety & privacy

- Report & block flows wired end-to-end (user → admin queue → resolution + audit).
- Shadow banning, suspension, verification review in the admin panel.
- GDPR: self-service data export (Art. 20) and account deletion with 30-day grace (Art. 17).
- Identity documents are never stored - verification providers return status only.
- Rate limiting on auth, swipes, messages and reports; brute-force lockout on login.

## Production

See [PRODUCTION_CHECKLIST.md](./PRODUCTION_CHECKLIST.md) before going live.
