# Secret Rotation Runbook (L7.3.7 Phase H)

> **Status: NOT COMPLETE — operator action required.** Rotation needs Supabase,
> Vercel, and Twilio dashboard/CLI access, which the automated agent does not
> have. This runbook is the exact checklist; execute it and check every box
> before declaring a full security GO. **Never paste a secret value into a
> commit, PR, chat, or CI log.**

## Scope — treat as COMPROMISED (exposed during troubleshooting)

| # | Credential | Owner / where rotated | Consumed by |
|---|------------|-----------------------|-------------|
| 1 | **PostgreSQL database password** | Supabase → Project → Database → Reset password | `DATABASE_URL`, `DIRECT_URL` (Vercel + local `.env`) |
| 2 | **`SUPABASE_WEBHOOK_SECRET`** | generate new high-entropy value | webhook sender (Supabase) + Tirvea receiver |
| 3 | **Twilio Auth Token** | Twilio Console → Account → Auth Tokens (promote secondary) | phone-OTP send/verify |
| 4 | **`SUPABASE_SERVICE_ROLE_KEY`** (if visible in screenshots) | Supabase → API → rotate service_role JWT | server-side admin API |
| 5 | Any other private server credential visibly exposed | its owning provider | — |

## Do NOT rotate (public by design)

- `NEXT_PUBLIC_SUPABASE_URL` (public URL)
- Supabase **anon / publishable** key (RLS-scoped, public by design) — unless a
  separate policy requires it.

## Standard sequence (every credential)

A. **Inventory** every place the secret is used (Vercel Production, Preview,
   Development; local `.env`; any CI secret).
B. **Generate** the replacement in the owning provider.
C. **Update Vercel Production** (Project → Settings → Environment Variables).
D. **Update Preview/Development** only where actually required.
E. **Update local `.env`** — never commit it (`.env` is git-ignored; verify with
   `git check-ignore .env`).
F. **Redeploy** so the new value is picked up.
G. **Verify** the integration works with the new value.
H. **Revoke** the previous credential in the provider.
I. **Confirm** the old credential no longer works.

## Per-credential specifics

### 1. PostgreSQL password
- Reset in Supabase; it changes the password segment of **both** `DATABASE_URL`
  (`:6543`, `pgbouncer=true`) and `DIRECT_URL` (`:5432`).
- **URL-encode** special characters in the password (`@`→`%40`, `:`→`%3A`,
  `/`→`%2F`, etc.) or the URL will misparse (this caused a `P1013` earlier).
- Update Vercel Production + local `.env`, redeploy, then verify:
  ```bash
  npm run db:migrate:status     # expect: Database schema is up to date!
  npm run db:schema:verify      # expect: schema verify OK
  TARGET=https://tirvea.com npm run release:smoke   # health.database == ok
  ```
- Old password stops working automatically once reset (single active password).

### 2. `SUPABASE_WEBHOOK_SECRET`
- Generate a new random high-entropy value (e.g. `openssl rand -hex 32`).
- Update **both** the webhook **sender** (Supabase webhook config) and the
  Tirvea **receiver** env — they must match.
- Verify: a correctly-signed webhook is **accepted**; a tampered/invalid
  signature is **rejected** (send one of each and confirm 2xx vs 4xx).

### 3. Twilio Auth Token
- Twilio supports two tokens: create a **secondary**, deploy it everywhere,
  confirm phone OTP send + verify works, then **promote** it to primary and
  delete the old — zero-downtime.
- Verify: phone-OTP **send** delivers an SMS and **verify** completes.
- Confirm the old token is rejected by the Twilio API afterwards.

### 4. `SUPABASE_SERVICE_ROLE_KEY` (only if it was exposed)
- Rotating the service_role JWT signing changes anon too — coordinate; prefer
  Supabase's key-rotation flow. Update every server-side consumer + CI
  `CI_SUPABASE_SERVICE_ROLE_KEY` (use a **dedicated CI/staging project**, never
  Production, for the live test lane).

## Completion gate

Do **not** claim a full production security GO until **every** box above is
checked, each integration re-verified with the new value, and each old
credential confirmed dead. Record the rotation date/operator here when done:

- [ ] PostgreSQL password — rotated / verified / old revoked
- [ ] `SUPABASE_WEBHOOK_SECRET` — rotated / both sides updated / signature checks pass
- [ ] Twilio Auth Token — rotated / phone OTP verified / old revoked
- [ ] `SUPABASE_SERVICE_ROLE_KEY` — rotated if exposed / consumers updated
- [ ] Any other exposed credential — rotated / revoked
