# Admin setup - roles, authorization and the one-time SUPER_ADMIN bootstrap

## Role model

`User.role` (Prisma enum `Role`): `USER < MODERATOR < ADMIN < SUPER_ADMIN`.

- The role is attached to **`User.id`, which IS the Supabase auth uid**
  (`auth.users.id`). It is never keyed by email, phone or provider
  metadata, so changing sign-in email, adding Google, or swapping phone
  numbers cannot move or drop a role.
- `SUPER_ADMIN` holds every `ADMIN` permission plus the supers-only tier
  in `src/lib/rbac.ts`: `roles:assign` and `diagnostics:view`
  (the `/admin/auth-diagnostics` page). Existing `ADMIN` permissions are
  unchanged.

## Where authorization is enforced (single source)

All admin access flows through central helpers - never ad-hoc
`role === "..."` checks:

| Surface                        | Helper                                                                               | Failure behavior                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/admin` layout + pages        | `getCurrentAdmin()` / `getCurrentAdmin("super")` in `src/lib/auth/require-user.ts`   | unauthenticated -> redirect `/login`; signed-in non-admin -> renders the calm **Access Denied** page (`src/app/admin/access-denied.tsx`), no redirect away |
| Page guards outside the layout | `requireAdmin()` / `requireSuperAdmin()` (same file)                                 | redirect `/login` or `/admin`                                                                                                                              |
| `/api/admin/*` routes          | `requirePermission("<permission>")` in `src/lib/api.ts`                              | 401 unauthenticated / 403 forbidden                                                                                                                        |
| Admin server actions           | `requireActor("<permission>")` in `src/app/admin/actions.ts` (wraps `hasPermission`) | throws Forbidden                                                                                                                                           |

Suspended/banned accounts cannot reach any of these: `auth()`
(`src/lib/auth.ts`) refuses to mint a session for `SUSPENDED`/`DELETED`
rows and signs them out; `getCurrentAdmin` re-checks `status === "ACTIVE"`
as defense in depth.

## One-time SUPER_ADMIN bootstrap

Environment (both **server-only**, see `.env.example`):

```
ADMIN_BOOTSTRAP_EMAIL="info@tirvea.com"
ADMIN_BOOTSTRAP_SECRET="<openssl rand -hex 32>"
```

Both paths funnel through `src/lib/services/admin-bootstrap.ts` and share
the same guards:

- **Auto-disabling / idempotent**: if ANY `SUPER_ADMIN` exists the
  mechanism answers "gone" (HTTP 410) forever - success disables it.
- Promotes only an **existing, email-verified, ACTIVE** app user found by
  normalized (trimmed, lowercased) email. It never creates accounts.
- Fully audited: `AdminLog` action `admin.bootstrap` plus an
  `AuthVerificationEvent` (`admin_bootstrap`).

### Preferred path: the script

```
npx tsx scripts/bootstrap-admin.ts
```

Direct DB, no HTTP - shell access to the deployment environment is the
credential. Prints the setup steps if the account is not ready.

### Online path: the API

```
curl -X POST https://tirvea.com/api/admin/bootstrap \
  -H "x-bootstrap-secret: $ADMIN_BOOTSTRAP_SECRET"
```

Contract: `401` wrong/missing secret (rate-limited per IP), `503`
`ADMIN_BOOTSTRAP_EMAIL` unset, `410` already bootstrapped, `409` account
not ready (body carries the exact setup instructions), `200` promoted.

### The 7-step production setup (spec PART 13)

1. Open the production site and go to `/login`.
2. Sign in with `info@tirvea.com` (email code, or Google if it uses that
   address) - this creates the app account.
3. Enter the one-time code sent to the inbox to verify the email.
4. Complete the required steps (age confirmation, terms) until the app opens.
5. In Settings -> Account & verification, confirm the email shows as verified.
6. Run the bootstrap: `npx tsx scripts/bootstrap-admin.ts` (preferred), or
   `POST /api/admin/bootstrap` with the `x-bootstrap-secret` header.
7. Sign out and back in, then open `/admin` - the account is `SUPER_ADMIN`.

After success, remove `ADMIN_BOOTSTRAP_SECRET` (and optionally the email)
from the environment. Further role changes belong to a future
`roles:assign` admin surface, guarded by `SUPER_ADMIN`.

## RLS / data-path note

Admin reads and writes go through **Prisma on the server** (service
credentials), not through the browser Supabase client - so authorization
is enforced in server services/routes via the central helpers above, not
by RLS policies:

- `SUPABASE_SERVICE_ROLE_KEY` and `ADMIN_BOOTSTRAP_SECRET` are server-only.
  `src/lib/supabase/admin.ts` imports `server-only`, so the build fails if
  a client component graph ever pulls it in; the client bundle grep in the
  test battery asserts neither name appears in `.next/static`.
- Admin tables (`AdminLog`, `AuthVerificationEvent`) are written via
  `audit()` / `recordAuthEvent()` and read ONLY by admin pages behind the
  role gates; no public route exposes them.
- The settings PATCH schema (`settingsPatchSchema`) is `.strict()` and has
  no `role` field - no client payload anywhere can set a role
  (asserted by `tests/admin-authz.test.ts`).

## Diagnostics

`/admin/auth-diagnostics` (SUPER_ADMIN only): auth uid, masked +
normalized email, role, status, session/linked providers,
`auth.users.last_sign_in_at`, `NODE_ENV`, and whether
`SUPABASE_SERVICE_ROLE_KEY` is configured - by name only, never values.
Every view writes an `AdminLog` row (`admin.diagnostics.view`).

## Trust & Safety operations

The moderation queues, SLA policy, appeals handling, provider runbooks and
the full T&S environment-variable reference live in
[docs/TRUST-SAFETY.md](./TRUST-SAFETY.md).
