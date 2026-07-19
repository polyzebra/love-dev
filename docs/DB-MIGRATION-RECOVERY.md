# Database migration recovery & the deploy-order contract

> Production incident (L7.3.x): the app was deployed with a Prisma **client** that
> expected columns (`User.galleryVersion` …) whose **migrations had not been
> applied** to the production database → every request-path read 500'd with
> `P2022`. Recovery was then blocked by a **failed** migration,
> `20260713150000_realtime_chat_authorization` (`P3018` / `3F000
> schema "realtime" does not exist`), which was not portable to a database
> without Supabase Realtime.

## The invariant

**Migrations must be applied to a database BEFORE (or atomically with) deploying
an app build whose Prisma client expects them.** The app must never run ahead of
its schema. Migrations must apply on **any** Postgres, including one without
Supabase Realtime (the CI ephemeral `postgres:16`, and the production DB that
raised `3F000`).

## Writing a portable migration

- Reference `realtime.*` (or any optionally-present schema/role) **only** inside a
  guarded `DO $$ … END $$` block. PostgreSQL parses policy DDL against the live
  catalog, so a bare `CREATE/DROP POLICY … ON realtime.messages` fails at **parse
  time** when the relation is absent — it must run via `EXECUTE` dynamic SQL,
  guarded by `to_regnamespace('realtime') IS NOT NULL AND
  to_regclass('realtime.messages') IS NOT NULL`.
- Guard role-scoped `GRANT/REVOKE` with `pg_roles` existence checks
  (`anon`, `authenticated`, `supabase_realtime_admin` are Supabase-only).
- Prefer idempotent forms: `CREATE OR REPLACE FUNCTION`, `DROP … IF EXISTS`,
  `ADD COLUMN IF NOT EXISTS`. Never `CREATE SCHEMA realtime` just to satisfy a
  migration; never `prisma db push`; never drop tables/data.
- Enforced by `tests/migration-portability.test.ts` and
  `tests/prisma-migration-drift.test.ts` (CI unit lane).

## Recovering a FAILED migration (P3018)

Run against the verified production **direct, non-pooled** connection (`DIRECT_URL`,
port 5432 — the pooler hangs the Prisma CLI on this project):

1. **Patch the migration SQL** to be portable + idempotent (as above). Commit it.
2. **Confirm no completed effects persisted.** Postgres DDL is transactional and
   Prisma wraps each migration in a transaction, so a mid-migration failure rolls
   the whole migration back — evidence: query for its objects
   (`to_regproc('public.realtime_can_join_conversation')`, the policy, and the
   `_prisma_migrations` row's `applied_steps_count` / `rolled_back_at`). The
   patched SQL is idempotent regardless, so re-apply is safe either way.
3. **Mark it rolled back** (do **not** use `--applied` to bypass; do **not** edit
   `_prisma_migrations` by hand):
   ```
   DATABASE_URL="$DIRECT_URL" npx prisma migrate resolve --rolled-back 20260713150000_realtime_chat_authorization
   ```
4. **Apply everything:**
   ```
   DATABASE_URL="$DIRECT_URL" npx prisma migrate deploy
   DATABASE_URL="$DIRECT_URL" npx prisma migrate status   # expect: up to date
   ```
   (If the CLI hangs even on the direct URL, apply each committed
   `migration.sql` via `npm run db:apply-migration -- <dir> --confirm`, then
   reconcile `_prisma_migrations`; prefer `migrate deploy`.)
5. **Verify schema** (Phase D): `User.galleryVersion` + the trust-contract columns
   and `Verification.galleryVersionAtStart` exist; **no failed migration remains.**
6. **Verify function** (Phase E): request a fresh production email OTP, enter the
   real code, and confirm `POST /api/auth/email/verify` returns success (not 503),
   the session cookie is set, redirect proceeds, and the logs show **no P2022 /
   no auth_unavailable**.

## Deploy-order enforcement (do this once, permanently)

The active delivery path (Vercel git auto-deploy) builds the app but does **not**
run migrations; the CI-gated deploy that would is inactive. **Add a release step
that runs `prisma migrate deploy` against `DIRECT_URL` before the app goes live**
(activate the CI-gated deploy, or a Vercel release/predeploy hook). Until then,
run step 4 manually on every schema-changing deploy.
