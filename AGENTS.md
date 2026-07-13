<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Tirvea: Premium Dating SaaS

Production-grade platform for verified, intention-driven dating. Verified profiles. Honest intentions. Premium experience. Built mobile-first with a custom design system.

## 🚀 Quick Start for Agents

### Setup
```bash
npm install
cp .env.example .env
npx auth secret          # paste into AUTH_SECRET
npx prisma migrate dev --name init
npx prisma db seed
npm run dev              # http://localhost:3000
```

### Seeded Accounts (Dev Only)
- **Admin**: `admin@tirvea.app` / `admin-tirvea-2026` → `/admin`
- **Demo members**: `saoirse@demo.tirvea.app` (+ 5 more) / `demo-tirvea-2026`

### Common Commands
| Command | Purpose |
|---------|---------|
| `npm run dev` | Turbopack dev server on :3000 |
| `npm run build && npm start` | Production build + serve |
| `npm run lint` | ESLint check |
| `npx prisma migrate dev` | Create/apply migration |
| `npx prisma db seed` | Seed demo catalogue + users |
| `npx prisma studio` | Browser database UI |
| `npx tsx tests/*.test.ts` | Run integration tests (real DB) |
| `npx tsx scripts/bootstrap-admin.ts` | Create SUPER_ADMIN |

---

## 🏗️ Architecture & Patterns

### 1. Edge-Safe Auth with Graduated Trust
- **Key principle**: Auth keyed by Supabase UID only, never email
- Canonical session resolver: `auth()` in [src/lib/auth.ts](src/lib/auth.ts#L1)
- JWT validated locally (zero network on warm hit) — auth is React-cached
- **Critical gotcha**: Suspended/banned users KEEP their sessions and are routed to `/account-blocked`, not signed out
- Phone-keyed accounts have no email; Google accounts are UID-locked

### 2. Explicit RBAC (No Wildcards or Role Hierarchy)
- Permission model: `MODERATOR < ADMIN < SUPER_ADMIN`
- Every permission explicitly defined in [src/lib/rbac.ts](src/lib/rbac.ts#L1) (no wildcards)
- SUPER_ADMIN holds supers-only tier (`roles:assign`, `diagnostics:view`) + all ADMIN permissions
- **Enforcement points**:
  - API routes: `requirePermission()` (returns 403 if denied)
  - Server actions: `requireActor()` (checks session + permission)
  - Pages: `getCurrentAdmin()` (returns null if not admin)
- **Pattern**: Always check permissions centrally, never scattered across handlers

### 3. Consistent API Response Envelope
- **Every endpoint returns** `{ data: T }` (2xx) or `{ error: { code, message, fields?: Record<string, string[]> } }` (4xx/5xx)
- Use helpers from [src/lib/api.ts](src/lib/api.ts#L1): `ok(data)`, `created(data)`, `apiError(code, msg)`, `validationError(fields)`
- User input validated via Zod schemas in [src/lib/validators/](src/lib/validators/) before business logic
- **Pattern**: Thin route handler calls service layer; domain logic lives in services

### 4. Trust & Safety Graduated Enforcement
- Account status ladder: `ACTIVE → LIMITED (temp) → PHOTO_REVIEW_REQUIRED → SUSPENDED → BANNED → DELETED`
- Single source of truth: [src/lib/services/trust-safety.ts](src/lib/services/trust-safety.ts#L1)
- Key functions: `graduatedActionFor()`, `applyDirectAction()`, `handleAppeal()`
- Suspended/banned users can read violations and appeal; double-appeals return 409 Conflict
- Everything audit-logged to `AuditLog` table

### 5. Database: Prisma + PostgreSQL with Edge Auth
- Singleton in [src/lib/db.ts](src/lib/db.ts#L1) using PrismaPg adapter
- **Both URLs required**: `DATABASE_URL` (pooled for queries) + `DIRECT_URL` (direct for migrations)
- Schema strongly typed via enums (`Role`, `AccountStatus`, `RelationshipGoal`, etc.) — **never use string literals**
- Import enums: `import { Role } from '@/generated/prisma/enums'`
- Never edit `src/generated/prisma/` (regenerate with `prisma generate`)
- Hot paths pre-indexed: discovery feeds, match lookups, chats

### 6. Edge Middleware & Protected Routes
- Middleware in [src/proxy.ts](src/proxy.ts#L1) refreshes Supabase JWT without network on warm cache
- Protected routes centrally listed in `PROTECTED` array — add new routes there, not scattered
- Edge layer gates all `/app/*` and `/admin/*` routes
- Rate limiting: keyed by `api:${user.id}` or IP, returns 429 with `Retry-After` header
- Legacy PWA redirects at edge (`/auth` → `/login` at 308)

### 7. Next.js 16 Specifics
- **Server Components first**: Most pages/components are Server Components unless using client interactivity
- React 19 caching: `use()`, `useCallback`, and form submissions change semantics
- Turbopack on dev (faster rebuilds than Webpack)
- Check `node_modules/next/dist/docs/` before writing new code

---

## 📋 File Structure & Key Files

### `src/app/`
- `(marketing)/` — Landing, pricing, legal, safety (static, SEO-first)
- `(auth)/` — Login, register, password reset, email verification
- `(app)/` — Authenticated routes: discover, matches, chat, profile, settings
- `onboarding/` — 6-step profile wizard (pre-app)
- `admin/` — RBAC-gated admin panel (dashboard, users, reports)
- `api/` — Route handlers (thin controllers over services)

### `src/lib/`
- [auth.ts](src/lib/auth.ts) / [auth.config.ts](src/lib/auth.config.ts) — Auth.js v5 setup (edge-safe split)
- [db.ts](src/lib/db.ts) — Prisma singleton + PrismaPg adapter
- [api.ts](src/lib/api.ts) — Response envelope helpers + guards (session, RBAC, rate limit)
- [rbac.ts](src/lib/rbac.ts) — Permission → role matrix (explicit, no wildcards)
- [tokens.ts](src/lib/tokens.ts) — Hashed one-time tokens (email, reset, OTP)
- `services/` — Business logic (discovery, matching, trust-safety, etc.)
- `validators/` — Zod schemas for every API boundary

### `src/components/`
- `ui/` — shadcn/ui primitives (30+)
- `shared/` — Logo, badges, empty states, page headers
- `app/` — Swipe deck, chat thread, nav, settings forms
- `auth/`, `marketing/`, `onboarding/` — Feature-specific components

### `prisma/`
- [schema.prisma](prisma/schema.prisma) — Data model (strongly typed enums, indexes)
- `migrations/` — Versioned schema changes (apply with `DATABASE_URL` + `DIRECT_URL`)
- [seed.ts](prisma/seed.ts) — Demo data + catalogue seeding

### `docs/` (Link, Don't Duplicate)
- [DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md) — Token consolidation, identity, color system
- [AUTH-SETUP.md](docs/AUTH-SETUP.md) — Auth.js provider config
- [ADMIN-SETUP.md](docs/ADMIN-SETUP.md) — Bootstrap + RBAC enforcement
- [TRUST-SAFETY.md](docs/TRUST-SAFETY.md) — Enforcement policy + appeals
- [NOTIFICATIONS-NATIVE.md](docs/NOTIFICATIONS-NATIVE.md) — Web Push setup

---

## ⚠️ Common Pitfalls

1. **Email != Session key**: Auth is keyed by Supabase UID. Changing a user's email doesn't change their role/session.
2. **Suspended users keep sessions**: They're routed to `/account-blocked` at middleware, not signed out. Plan for this in UI.
3. **Two database URLs**: Forgetting `DIRECT_URL` breaks migrations. Both must point to the same PostgreSQL instance.
4. **Never edit generated files**: `src/generated/prisma/` is regenerated by `prisma generate`. Edit the schema, not the output.
5. **Enum imports**: Always import enums from `@/generated/prisma/enums`, never use string literals.
6. **Middleware rate limits**: Rate limiting is per-user-id on `/api/*`. High-volume scripts will hit 429.
7. **No role hierarchy inference**: ADMIN permissions do NOT inherit MODERATOR; list every role's permissions explicitly.
8. **Phone-keyed accounts have no email**: Some users exist only with `phone` + `country`. Handle null email gracefully.
9. **Migrations in CI**: Migrations don't auto-apply. Pipeline must run `prisma migrate deploy`.
10. **React 19 caching**: `use()` and form behavior differs. Read the Next.js 16 docs, not older React patterns.

---

## 🧪 Testing & Scripts

- **Integration tests** in `tests/*.test.ts` use `tsx` (real DB, full stack)
- Pattern: [tests/trust-safety.test.ts](tests/trust-safety.test.ts#L1)
- **Bootstrap admin**:
  ```bash
  npx tsx scripts/bootstrap-admin.ts
  ```
  Creates SUPER_ADMIN account with all permissions
- **Phone release script**:
  ```bash
  npx tsx scripts/test-trust-actions.ts
  ```

---

## 🎨 Design System

Token architecture: **Primitive → Semantic → Component**

- **Colors**: Brand scale (rose) is theme-invariant; others inherit per-theme values
- **Typography**: Editorial serif (`font-display`: Playfair) + sans default
- **Motion**: Motion.js (Framer Motion successor) for springs, 60fps transforms
- **Accessibility**: shadcn/ui primitives (Radix) + WCAG compliance

See [docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md) for token details, Aurora ambience, glass/noise materials.

---

## 📊 Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 (App Router, Server Components first, Turbopack) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v4 + custom design tokens |
| Components | shadcn/ui (30+) + bespoke app components |
| Motion | Motion.js (Framer Motion successor) |
| Database | PostgreSQL (Supabase-compatible) via Prisma 7 + PrismaPg |
| Auth | Auth.js v5 (email/password, Google, Apple, JWT sessions) |
| Validation | Zod on every API boundary |
| Payments | Stripe (webhook architecture, Revolut-ready) |
| Email | Provider-agnostic (Resend-ready, console in dev) |
| Push | Web Push (native notifications) |

---

## 🔗 Additional Resources

- [README.md](README.md) — Quick start + stack overview
- [docs/](docs/) — All feature documentation (trust-safety, auth, notifications, admin)
- [next.config.ts](next.config.ts) — Build config
- [tsconfig.json](tsconfig.json) — TypeScript strict mode + paths
- [components.json](components.json) — shadcn/ui component registry
