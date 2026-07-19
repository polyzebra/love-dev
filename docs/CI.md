# CI & Delivery Gates (Phase 0B)

Pipeline: `.github/workflows/ci.yml` — runs on every pull request and
every push to `main`. Nothing in it depends on a developer machine:
installs use `npm ci` against the lockfile, the integration database is
an ephemeral Postgres 16 service container migrated with
`prisma migrate deploy` and seeded with `prisma db seed`, and all
provider transports in the gated test lanes are the suites' own
injected fakes.

## Required checks

| Job         | What it proves                                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| quality     | `prettier --check`, ESLint (0 errors), `tsc --noEmit`, forbidden-NEXT_PUBLIC guard (`scripts/check-public-env.mjs`)                                                                  |
| unit        | 5 no-DB source-contract suites (`npm run test:unit`)                                                                                                                                 |
| prisma      | `prisma validate`; committed generated client has zero drift vs `prisma generate`; migration history replays onto an empty DB; `migrate diff --exit-code` proves migrations ≡ schema |
| integration | 16 Prisma-backed suites against the ephemeral DB (`npm run test:integration`); plus the 4 live-Supabase suites when `CI_SUPABASE_*` secrets exist                                    |
| build       | `next build` with no env (env validation is lazy by design — verified)                                                                                                               |
| audit       | `npm audit --omit=dev --audit-level=high` — production deps must be free of HIGH/CRITICAL advisories; moderates are reported, not blocking; dev-only deps do not gate                |
| secrets     | gitleaks v8.24.3 (pinned) filesystem scan of the checkout, `--redact`                                                                                                                |
| deploy      | see below                                                                                                                                                                            |

Local aggregate: `npm run ci` (format:check → lint → typecheck →
db:validate → check:public-env → test:unit → build).
Full local sweep: `npm test` (all 25 suites, uses `.env`).

## Test lanes (scripts/run-tests.mjs)

- **unit** — auth-form-stack, auth-url, billing-ui, login-routes,
  notifications-web-surface. No DB, no env.
- **integration** — the 16 suites that import `src/lib/db` but inject
  all external transports (Stripe spy, push transport, moderation
  providers). Need only a migrated+seeded Postgres.
- **live** — admin-authz, auth-cleanup, identity-invariants, phone-sync:
  construct real `@supabase/supabase-js` clients. CI runs them only when
  the `CI_SUPABASE_*` secrets are configured; locally they run against
  `.env` as always.

## Blocking production deploys

Two-part mechanism, **inactive by default** so shipping this workflow
changed no production behaviour:

1. `vercel.json` `ignoreCommand` skips **production** git builds only
   when the Vercel env var `CI_DEPLOYS_ONLY=1` is set (Production scope).
   Preview builds are never affected. Unset the var to instantly restore
   git auto-deploys (rollback is a dashboard toggle, no code change).
2. The workflow's `deploy` job runs only on push to `main`, **needs every
   other job green**, is serialized by a `production-release` concurrency
   lock, and is **migration-gated**: it runs `npm run release:production`
   (preflight → `migrate deploy` on `DIRECT_URL` → schema verify) **before**
   building/promoting the same commit (`vercel deploy --prebuilt --prod`),
   then smokes the live deployment. Migrations always run before the app is
   activated — the fix for the L7.3.x incident. If `VERCEL_TOKEN` or
   `PROD_DIRECT_URL` is absent it exits with a notice instead of failing.

The full contract, scripts, rollback, and smoke procedure live in
[RELEASE.md](RELEASE.md); secret rotation in [SECRET-ROTATION.md](SECRET-ROTATION.md).

Activation order (do not reverse): add the Vercel + `PROD_DATABASE_URL` /
`PROD_DIRECT_URL` secrets → watch one green `deploy` job ship end-to-end
(gate → build → deploy → smoke) → then set `CI_DEPLOYS_ONLY=1`. From that
moment a red check blocks production.

## Required CI environment (names only — never commit values)

GitHub repository secrets:

| Secret                         | Purpose                                                             | Needed for                |
| ------------------------------ | ------------------------------------------------------------------- | ------------------------- |
| `VERCEL_TOKEN`                 | Vercel CLI auth for the gated deploy                                | deploy job                |
| `VERCEL_ORG_ID`                | Vercel scope                                                        | deploy job                |
| `VERCEL_PROJECT_ID`            | Vercel project                                                      | deploy job                |
| `PROD_DATABASE_URL`            | production runtime pooler URL (migration same-project check)        | deploy job (DB gate)      |
| `PROD_DIRECT_URL`              | production DIRECT_URL (`:5432`) — Prisma Migrate target             | deploy job (DB gate)      |
| `PROD_SUPABASE_URL`            | production Supabase URL for the post-deploy smoke OTP e2e           | deploy job (smoke, opt.)  |
| `PROD_SUPABASE_SERVICE_ROLE_KEY` | production service-role key for the smoke OTP e2e                 | deploy job (smoke, opt.)  |
| `CI_SUPABASE_URL`              | throwaway/staging Supabase project URL                              | live test lane (optional) |
| `CI_SUPABASE_ANON_KEY`         | its anon key                                                        | live test lane (optional) |
| `CI_SUPABASE_SERVICE_ROLE_KEY` | its service-role key — use a dedicated CI project, never production | live test lane (optional) |

Vercel project env (Production): `CI_DEPLOYS_ONLY=1` — the enforcement
switch described above.

Everything else the pipeline needs is a committed dummy (see the `env:`
block in the workflow) or provisioned inside the run (service Postgres).

## Rollback notes

- Workflow misbehaving: revert the commit or disable the workflow in the
  Actions UI; Vercel git auto-deploy is unaffected while
  `CI_DEPLOYS_ONLY` is unset.
- Deploy gating misbehaving after activation: unset `CI_DEPLOYS_ONLY`
  (instant return to auto-deploy), then investigate.
- `vercel.json` change is inert without the env var; `git revert` also
  restores the previous file byte-for-byte.

## Production verification steps (first activation)

1. Push a trivial change → all checks green → `deploy` job ships it →
   confirm the deployment in the Vercel dashboard and `tirvea.com`.
2. Open a PR with a deliberately failing test → checks red → confirm no
   production deployment occurred.
3. Only then set `CI_DEPLOYS_ONLY=1` and repeat step 1.
