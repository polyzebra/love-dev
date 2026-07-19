# Production Release Contract (L7.3.7)

> **Why this exists.** The OTP incident happened because an application build
> carrying a newer Prisma **client** reached Production **before** the matching
> database **migrations** ran. The app ran ahead of its schema and every
> request-path read 500'd with `P2022 User.galleryVersion does not exist`.
> This contract makes that impossible: **migrations always run and verify
> before the app is activated, fail-closed, on the same commit.**

## The one command

```bash
npm run release:production
```

Runs the pre-activation **database gate** in order, stopping the release on any
failure (no new build is activated):

1. `release:preflight` — config validation (targets sane, same project)
2. `db:migrate:deploy` — apply pending migrations via **DIRECT_URL**
3. `db:schema:verify` — status clean, history intact, `galleryVersion` present

In CI (`.github/workflows/ci.yml` → `deploy` job) the build, Vercel promotion,
and smoke tests run **around** this gate. You almost never run the full release
by hand — CI is the authoritative path. `release:production` is the exact gate
CI runs, so you can dry-run it locally against Production first.

## The mandatory order (fail-closed)

| # | Stage | Command | On failure |
|---|-------|---------|-----------|
| 1 | Preflight config validation | `release:preflight` | stop |
| 2 | Migration-history validation | `db:migrate:status` (inside verify) | stop |
| 3 | Production migration deploy | `db:migrate:deploy` | stop |
| 4 | Schema verification | `db:schema:verify` | stop |
| 5 | Application build | `vercel build --prod` (CI) | stop |
| 6 | Production deployment | `vercel deploy --prebuilt --prod` (CI) | stop; keep previous |
| 7 | Post-deploy smoke | `release:smoke` | fail the release |
| 8 | GO decision | all green | — |

If any stage fails: the release stops, **no new build is activated**, and the
previous healthy Production deployment stays live.

## Two connection roles — never mix them

| Role | Env var | Supabase endpoint | Used by |
|------|---------|-------------------|---------|
| **Runtime** traffic | `DATABASE_URL` | transaction pooler `:6543` (`pgbouncer=true`) | the app |
| **Migration** traffic | `DIRECT_URL` | session/direct `:5432` | Prisma Migrate |

Prisma Migrate **must** use `DIRECT_URL` — the transaction pooler lacks the
session features/advisory locks Migrate needs and will hang. Every release
script forces `DATABASE_URL=$DIRECT_URL` for the Prisma CLI (`scripts/release/_env.mjs`).
Both must point at database `postgres`, schema `public`, same project — the
preflight proves it.

## Release scripts (`scripts/release/`)

| npm script | File | Purpose |
|------------|------|---------|
| `db:migrate:status` | `migrate-status.mjs` | report migration status (redacted) |
| `db:migrate:deploy` | `migrate-deploy.mjs` | apply pending migrations, fail-closed |
| `db:schema:verify` | `schema-verify.mjs` | prove status clean + history + `galleryVersion` |
| `release:preflight` | `preflight.mjs` | validate DIRECT_URL/DATABASE_URL |
| `release:smoke` | `smoke.mjs` | post-deploy live smoke tests |
| `release:production` | `production.mjs` | the ordered DB gate (1→4) |

All scripts print **only redacted metadata** (host suffix, db, schema, migration
count) — never a password, token, or full connection string. Enforced by
`tests/release-governance.test.ts`.

`db:migrate:deploy` refuses to proceed when: `DIRECT_URL` is missing / malformed
/ not database `postgres`; the runtime and migration targets are different
projects; a **failed** migration is recorded (`P3009` — needs manual recovery,
never auto-resolved); or `migrate deploy` returns non-zero. It is idempotent
(a clean DB → "No pending migrations" → exit 0), so retrying after an
infrastructure blip is safe.

## Normal Production release

1. Merge to `main`. CI runs `quality / unit / visual / prisma / integration /
   build / audit / secrets`.
2. When all are green, the `deploy` job (serialized by the
   `production-release` concurrency lock) runs the **DB gate**, then builds and
   promotes the **same commit** (`--prebuilt`), waits until Ready, and smokes it.
3. A red check or a failed gate → no Production promotion.

## Preview release

Preview deploys (PRs / non-`main`) remain automatic and **must not** mutate the
Production database. They use Preview env vars and their own (or no) database.
Never point a Preview at the Production `DIRECT_URL`.

## Local development migrations

```bash
npm run db:migrate            # prisma migrate dev — LOCAL ONLY, creates a migration
```

- `prisma migrate dev` = **local development only** (creates + applies migrations).
- `prisma migrate deploy` = **staging / production** (applies committed migrations).
- `prisma db push` = **prohibited in Production** (schema mutation without a
  migration; drift with no history). CI fails if it appears in a Production
  workflow or release script (`tests/release-governance.test.ts`).

## Activation (operator, one-time — do not reverse the order)

The gated release is **inactive** until configured, so shipping it changed no
behaviour. To activate:

1. Add GitHub repo secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`,
   `PROD_DATABASE_URL`, `PROD_DIRECT_URL` (and optionally `PROD_SUPABASE_URL` /
   `PROD_SUPABASE_SERVICE_ROLE_KEY` for the smoke OTP e2e).
2. Push a trivial change → watch one green `deploy` job ship it end-to-end
   (gate → build → deploy → smoke).
3. Open a PR with a deliberately failing test → confirm no Production deploy.
4. Only then set the Vercel Production env var `CI_DEPLOYS_ONLY=1` — from that
   moment `vercel.json`'s `ignoreCommand` stops git auto-builds and **CI is the
   only path to Production.** A red check now blocks Production.

Rollback of the gating itself: unset `CI_DEPLOYS_ONLY` (instant return to git
auto-deploy). See [CI.md](CI.md).

## Rollback & failure recovery

- **Migrations fail before deploy:** stop; previous deployment stays active;
  inspect the failed migration. Do **not** `db push`; do **not** mark migrations
  applied without evidence. See [DB-MIGRATION-RECOVERY.md](DB-MIGRATION-RECOVERY.md).
- **App deploy fails after additive migrations:** additive migrations are
  backward-compatible, so the previous app build keeps working. Redeploy a
  compatible build; do **not** auto-roll-back the DB with destructive SQL.
- **Missing `_prisma_migrations` in Production:** the gate **fails immediately**
  and does **not** auto-baseline — follow the documented manual baseline
  recovery (evidence-based `migrate resolve --applied`) in
  [DB-MIGRATION-RECOVERY.md](DB-MIGRATION-RECOVERY.md).
- **Checksum mismatch / failed migration (`P3009`):** never auto-resolved in a
  normal release; manual recovery only.
- **Vercel deploy failure:** release goes red, previous deployment stays live.
- **Smoke-test failure:** the release is not GO; investigate against the live
  deployment; roll back by re-promoting the previous deployment in Vercel.
- **Secret-rotation failure:** see [SECRET-ROTATION.md](SECRET-ROTATION.md);
  do not mark a full security GO until rotation completes and old creds are dead.

## Smoke-test procedure

```bash
TARGET=https://tirvea.com \
NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… DIRECT_URL=… \
npm run release:smoke
```

Checks: `GET /` 200; `GET /api/health` (database `ok`); legal/auth pages;
auth send/verify endpoints reachable (no 5xx); a **fresh real email OTP**
verifies (200, session cookie, `next=/auth/phone`, `galleryVersion` readable);
phone-OTP endpoint reachable. Uses throwaway `@example.com` accounts and
**cleans them up**; OTP values are never logged.

## Ownership & approvals

- **Owner:** platform/release engineer merging to `main`.
- **Approval:** standard PR review + green required checks. Production promotion
  is automatic **only** through the gated `deploy` job once activated.
- **Migrations** touching existing columns/constraints: a second reviewer.
- **Secret rotation:** an operator with Supabase/Vercel/Twilio dashboard access
  (see [SECRET-ROTATION.md](SECRET-ROTATION.md)).
