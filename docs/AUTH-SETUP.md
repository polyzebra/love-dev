# Auth setup - production checklist

Everything the Supabase/Google/Vercel dashboards must contain for Tirvea's
auth to work in production. Code-side conventions live at the bottom.

## 1. Supabase - Authentication -> URL Configuration

**INCIDENT (2026-07): production Google sign-in on mobile Safari landed on
`localhost:3000/?code=...`.** The fingerprint matters: it is the ROOT path,
not `/auth/callback`. That means Supabase IGNORED the `redirectTo` the app
sent (it was not covered by the dashboard allow-list) and fell back to the
project's configured **Site URL**, which was still `http://localhost:3000`.
No code change can override that fallback - the dashboard values below are
mandatory:

| Setting | Value |
| --- | --- |
| Site URL | `https://tirvea.com` - **MUST be this.** It was `http://localhost:3000`; that is exactly why users landed on `localhost:3000/?code=...` |
| Redirect URLs | `https://tirvea.com/**` (**required** - without it every app `redirectTo` is ignored and Supabase falls back to Site URL) |
| | `https://tirvea.com/auth/callback` |
| | `https://tirvea.com/auth/confirm` |
| | `http://localhost:3000/**` (dev only - REMOVE for launch review) |

How to read a bad redirect in production:

- Lands on `<wrong-origin>/?code=...` (root path) -> Supabase used its Site
  URL fallback: the requested redirect was not in the Redirect URLs
  allow-list, or Site URL itself is wrong. Fix THIS dashboard section.
- Lands on `localhost:3000/auth/callback?...` -> the app itself built a
  localhost redirect: `NEXT_PUBLIC_SITE_URL` is missing/wrong in Vercel.
  Since the 2026-07 hardening, `src/lib/auth/url.ts` blocks localhost
  origins in production builds (logs `[auth:url] localhost redirect blocked
  in production` and falls back to `https://tirvea.com`), so this variant
  should no longer be reachable - but fix the env var regardless.

## 2. Google Cloud Console (OAuth client)

- APIs & Services -> Credentials -> your OAuth 2.0 Client ID
- **Authorized redirect URI** (the ONLY one needed):
  `https://<project-ref>.supabase.co/auth/v1/callback`
- Paste the client id + secret into Supabase -> Authentication -> Providers -> Google.
- The app always sends `prompt=select_account`, so account switching after
  sign-out is explicit.

### Linking Google to an existing account

Identity is `auth.users.id`; one email = one account (docs/IDENTITY.md).
Two ways a Google identity can end up on an existing account:

- **Automatic (same email only).** Supabase auto-links a Google sign-in to
  an existing `auth.users` row when the Google account's email equals that
  row's confirmed email. A user who registered with email-OTP
  `me@gmail.com` and later picks `me@gmail.com` in the Google chooser
  lands on the SAME account (a second row appears in `auth.identities`,
  same `user_id`). No app code involved.
- **Manual (different email).** Supabase supports
  `supabase.auth.linkIdentity({ provider: "google" })` called from the
  browser WHILE SIGNED IN to the account that should gain the identity;
  it runs the OAuth dance and attaches the new identity to the current
  uid. Requires **Authentication -> Providers -> "Allow manual linking"**
  to be enabled in the Supabase dashboard (off by default; off for
  Tirvea today). Tirvea intentionally ships no linking UI - the
  duplicate-phone 409 is answered with guidance instead, and accounts
  are never merged server-side.

Corollary: a user whose Google email differs from their OTP email holds
two separate accounts, and a phone number verified on one 409s on the
other - working as designed. Tell them to sign in with the method/email
that owns the number (the phone/send + phone/verify routes log
`phoneOwner=<id>` to the console on every 409).

## 3. Vercel environment variables

No `NEXT_PUBLIC_*` variable may carry a localhost value in the Production
environment, and `NEXT_PUBLIC_*` values are BAKED INTO THE BUNDLE at build
time - after changing any of them you must REDEPLOY (a plain restart is not
enough).

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | `https://tirvea.com` - canonical origin for every auth redirect; the source of truth for `src/lib/auth/url.ts` |
| `NEXT_PUBLIC_APP_URL` | `https://tirvea.com` - metadataBase (`src/app/layout.tsx`); never localhost in production |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon public key (browser-safe) |
| `SUPABASE_SERVICE_ROLE_KEY` | **server-only** - never expose with `NEXT_PUBLIC_`, never import into client components |
| `AUTH_HASH_SALT` | long random string; salts the SHA-256 hashes of IP/user-agent in the auth audit trail. Without it a dev constant is used and a warning logs |
| `TWILIO_ACCOUNT_SID` | Twilio Console -> Account Info. All three TWILIO_* vars set = Twilio Verify becomes THE phone provider (see section 5) |
| `TWILIO_AUTH_TOKEN` | **server-only** - the account's auth token (basic-auth secret for the Verify REST API) |
| `TWILIO_VERIFY_SERVICE_SID` | the `VA...` SID of the Verify service (see section 5 for creating one) |
| `SUPABASE_PHONE_ENABLED` | `"true"` ONLY once an SMS provider (Twilio) is configured in Supabase Phone Auth - fallback provider when the TWILIO_* trio is not set, see below |
| `DATABASE_URL` / `DIRECT_URL` | Supabase Postgres (pooled / direct) |

## 4. Email OTP template + expiry

Supabase -> Authentication -> Emails. TWO templates matter, because
signInWithOtp picks by account state:

- **"Confirm signup"** - sent to NEW email addresses. If this still
  contains `{{ .ConfirmationURL }}` ("Confirm your email address"
  link), new users get a link instead of a code - the exact bug this
  section prevents.
- **"Magic Link"** - sent to RETURNING email addresses.

BOTH templates must show `{{ .Token }}` (the 6-digit code the
/login/email/verify screen asks for) and must NOT use
`{{ .ConfirmationURL }}` as the primary action. Recommended subject
for both: "Your Tirvea verification code". A template with only
`{{ .ConfirmationURL }}` sends a link and no code, and code entry will always
fail. Recommended body: show `{{ .Token }}` prominently, keep
`{{ .ConfirmationURL }}` as a fallback link.

**Expiry:** Supabase -> Authentication -> Providers -> Email -> "Email OTP
Expiration" must be set to **600 seconds (10 minutes)** so email codes match
the SMS code TTL. The default (1 hour) is far too generous for a 6-digit code.

## 5. Phone verification providers

Phone verification is HONEST: we only demand a phone number when we can
actually verify one. `phoneVerificationEnabled()` in `src/lib/auth/phone.ts`
is THE switch every gate/route asks; provider selection order:

1. **Twilio Verify** - when `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and
   `TWILIO_VERIFY_SERVICE_SID` are ALL set (this wins even if
   `SUPABASE_PHONE_ENABLED` is also `"true"`).
2. **Supabase Phone Auth** - when `SUPABASE_PHONE_ENABLED === "true"`.
3. **Neither** - the phone step is skipped everywhere; the phone API routes
   answer `503 "Phone verification is temporarily unavailable."`.

When any provider is enabled, the auth gate (`src/lib/auth/gate.ts`) requires
a verified phone before onboarding, and email sign-ins from a new network
re-challenge the phone.

### 5a. Twilio Verify setup

- Twilio Console -> **Verify -> Services -> Create new** ("Tirvea"). Copy the
  service SID (`VA...`) into `TWILIO_VERIFY_SERVICE_SID`; account SID + auth
  token come from Console -> Account Info.
- Verify OWNS the codes: generation, storage, expiry and attempt caps happen
  on Twilio's side - we never see or store an OTP. The code TTL is **10
  minutes by default** and configurable per service (Service -> Settings ->
  "Code expiration"); keep it at 10 minutes to match the email OTP expiry
  (section 4).
- Code length: keep the default 6 digits - the API routes and the OTP input
  validate `\d{6}`.
- The integration calls the Verify v2 REST API directly with `fetch`
  (`src/lib/auth/phone.ts`, `twilioVerifyProvider`): two form-encoded POSTs
  (`/Verifications`, `/VerificationCheck`) with basic auth. The `twilio` npm
  SDK is deliberately NOT a dependency - it would add a large transitive
  dependency tree (plus its own HTTP client) for two requests, and the
  fetch-based provider is unit-testable via an injected `fetchImpl`.
- Twilio policy rejections are never shown verbatim: error 60200 (invalid
  number), 60202 (max check attempts) and 60203 (max send attempts) map to
  our own neutral copy, with the real Twilio code kept in the audit trail
  metadata.
- With Twilio Verify the verified number is stamped on the app `User` row
  (`phoneE164` + `phoneVerifiedAt`) by the verify route - the Supabase auth
  user does not carry the phone identity.

### 5b. Supabase phone flow (fallback)

`"true"` requires Supabase -> Authentication -> Providers -> Phone enabled
with a live SMS provider. The phone is attached to the CURRENT signed-in user
via the `phone_change` flow (`auth.updateUser({ phone })` +
`verifyOtp(type: "phone_change")`) - it never creates a second, phone-keyed
identity.

### 5c. Phone LOGIN (anonymous, feature-flagged - separate from 5a/5b)

Phone LOGIN signs users IN with native Supabase phone auth
(`signInWithOtp({ phone })` + `verifyOtp(type: "sms")`), which keys
identity by **`auth.users.phone`**. It is a separate feature from the
authenticated phone-change flow above, at route (`/api/auth/phone-login/*`
vs `/api/auth/phone/*`), service (`phone-login-flow.ts` vs
`phone-flow.ts`) and audit level (`auth_phone_code_*`, `auth_login_*`
vs `phone_otp_*`).

**Architecture truth (proven live 2026-07-09):**

- `GET /auth/v1/settings` -> `external.phone: false` (provider OFF;
  `sms_provider: "twilio"` is merely the configured vendor name).
- `POST /auth/v1/otp {phone}` -> `400 phone_provider_disabled`.
- `auth.users`: 2 rows, **0** with `phone`, **0** with
  `phone_confirmed_at` - every verified number lives ONLY app-side
  (`User.phoneE164`; 1 verified owner at audit time), because Twilio
  Verify runs through OUR backend and writes app columns only.
- Therefore native phone OTP **cannot** sign an existing owner into their
  canonical account: GoTrue would mint a NEW phone-keyed auth user
  (uid != owner's `User.id`) - a duplicate canonical account, forbidden.
  Without a service-role key we can neither backfill `auth.users.phone`
  server-side nor fabricate sessions.

**Shipped policy (`src/lib/auth/phone-login-flow.ts`):**

- `PHONE_LOGIN_ENABLED` (default off) -> routes answer
  `503 PHONE_LOGIN_NOT_AVAILABLE`; the UI hides the button (never a dead
  one). `PHONE_LOGIN_COUNTRIES` (default `IE,GB`) allowlists regions -
  narrower than phone-change, which accepts any resolvable region.
- **Existing-owner bridge**: at send, an app-owned number whose
  `auth.users` mapping is missing/mismatched is refused with
  `409 IDENTITY_CONFLICT` before any SMS. At verify (defense in depth),
  a successful OTP whose session uid differs from the app owner is
  SIGNED OUT and answered `409 IDENTITY_CONFLICT`: "This number is
  already linked to an account that signs in another way. Use your email
  or Google to sign in, then add phone sign-in from Settings." No second
  app account is ever created; the owner's row is untouched.
- uid matches the owner -> normal login into the canonical account.
- Unowned number -> app account provisioned ONLY after the OTP approves
  (`provisionPhoneLoginUser`), phone stamped in the same write; the gate
  then continues age -> legal -> onboarding (the first gate rung accepts
  either verified channel).
- **Backfill (the exit ramp)**: with the flag on, every successful
  authenticated phone-change verify also calls
  `supabase.auth.updateUser({ phone })` on the live session
  (`syncPhoneToSupabaseAuth`, audited `phone_auth_sync[_failed]`, never
  blocks the app-side claim). Once `auth.users.phone` is populated,
  owners re-verifying (or newly verifying) unlock uid-match phone login.

**Dashboard config required to flip the flag:**

1. Supabase -> Authentication -> Sign In / Up -> **Phone: enable**.
2. Supabase -> SMS provider: **Twilio Verify**, with the SAME Verify
   service the backend uses (Account SID, Auth Token,
   `TWILIO_VERIFY_SERVICE_SID`).
3. Keep "confirm phone change" OFF so the backfill's
   `updateUser({ phone })` writes the column silently instead of texting
   a second code.
4. Set `PHONE_LOGIN_ENABLED="true"` (+ optionally
   `PHONE_LOGIN_COUNTRIES`).

**Full settings table (server env + dashboard):**

| Setting | Where | Value | Purpose |
| --- | --- | --- | --- |
| `PHONE_LOGIN_ENABLED` | server env | `"true"` | THE phone-login switch: shows the `/login` button, opens `/login/phone(/verify)`, arms the auth.users.phone backfill |
| `PHONE_LOGIN_COUNTRIES` | server env | `"IE,GB"` (default) | ISO allowlist for anonymous phone login |
| `TWILIO_ACCOUNT_SID` | server env | `AC...` | Twilio Verify (backend phone-change flow) |
| `TWILIO_AUTH_TOKEN` | server env | secret | Twilio Verify auth |
| `TWILIO_VERIFY_SERVICE_SID` | server env | `VA...` | The Verify service; use the SAME SID in the Supabase SMS provider so codes come from one pool |
| Phone provider | Supabase dashboard (Auth -> Sign In / Up) | ON | Without it `POST /auth/v1/otp {phone}` answers `400 phone_provider_disabled` |
| SMS provider | Supabase dashboard | Twilio Verify + same Verify SID | GoTrue sends the login OTPs through it |
| Confirm phone change | Supabase dashboard | OFF | The backfill's `updateUser({ phone })` must write silently, not text a second code |

**Live E2E status (2026-07-09, provider still OFF in the dashboard):**
`POST /api/auth/phone-login/send` with a valid IE number through the dev
server (flag on) returns the graceful
`503 SMS_PROVIDER_UNAVAILABLE` - GoTrue answered
`phone_provider_disabled` before creating anything, and SQL confirms NO
`auth.users` row and NO app `User` row was minted by the attempt.
Non-production builds return the actionable message ("Phone sign-in is
not configured: enable the Phone provider with Twilio Verify in Supabase
Auth settings."); production keeps the neutral "Text sign-in is
temporarily unavailable. Use email or Google instead.". The final
SMS-in-hand test unlocks the moment the two dashboard flips above are
made - no code change needed; the existing-owner invariant is already
proven by `tests/phone-login.test.ts` (spy-client suite, 12/12).

## 5d. Apple sign-in (feature-flagged, default OFF)

"Continue with Apple" (login entry `/login` + `oauth-buttons.tsx`) renders
ONLY when `NEXT_PUBLIC_APPLE_LOGIN_ENABLED="true"` (single source:
`appleLoginEnabled()` in `src/lib/auth/apple.ts`; the legacy
`NEXT_PUBLIC_APPLE_OAUTH=1` spelling is still honored). Never flip the
flag before BOTH prerequisites exist, or users get a dead provider:

1. **Apple Developer** (Certificates, Identifiers & Profiles):
   - an App ID, plus a **Services ID** (this is the OAuth client id) with
     *Sign in with Apple* enabled;
   - the Supabase callback registered as a Return URL:
     `https://<project-ref>.supabase.co/auth/v1/callback`;
   - a *Sign in with Apple* private key (`.p8`) + its Key ID and the
     10-char Team ID (used to mint the client-secret JWT, which Apple
     expires at most 6 months out - rotate it).
2. **Supabase Dashboard** -> Authentication -> Providers -> **Apple**:
   enabled with the Services ID as client id + the client-secret JWT.

The button then uses the exact same `signInWithOAuth` -> `/auth/callback`
-> `ensureAppUser()` path as Google.

## 6. Auth flow map (code reference)

**Route map (since 2026-07-09): `/login` is THE canonical entry.**

- `/login` - entry (Apple flag / Google / Email / Phone flag rows)
- `/login/email` -> `/login/email/verify` - email OTP journey (moved from
  `/auth` and `/auth/email-code`)
- `/login/phone` -> `/login/phone/verify` - phone OTP login (flag-gated)
- `/auth` -> 308 `/login` (`src/app/auth/route.ts`; carries `?next` /
  `?callbackUrl` only when same-origin relative) and `/auth/email-code`
  -> 308 `/login/email/verify` (carries `?email`). The same
  normalization also runs in the edge middleware (`src/proxy.ts`,
  `legacyAuthRedirect`) as defense-in-depth for cached/PWA clients.
- `/auth/age`, `/auth/legal`, `/auth/recovery`, `/auth/callback` -
  UNCHANGED (authenticated steps + OAuth callback)

- `src/lib/auth/url.ts` - `siteUrl()` / `authRedirectUrl()`; the only way redirect URLs are built
- `src/app/auth/callback/route.ts` - OAuth/magic-link callback; idempotent against re-used codes
- `src/lib/auth/identity.ts` - `ensureAppUser()`: the single app-User provisioning path (callback + email verify)
- `src/lib/auth/gate.ts` - `authNextStep()`: blocked -> email -> phone (if enabled) -> onboarding -> app
- `POST /api/auth/email/send` `{email}` -> always `{ok:true, retryAfter}` (neutral; disposable/limited differ only in audit - `retryAfter` = seconds until the resend unlocks)
- `POST /api/auth/email/verify` `{email, code}` -> `{ok:true, next}` or neutral failure
- `POST /api/auth/phone/send` `{phoneE164, countryIso?, dialCode?}` (session required) -> `{ok:true, retryAfter}` (limited sends are indistinguishable from real ones)
- `POST /api/auth/phone/verify` `{phoneE164, code}` -> `{ok:true, next}` (+ guarded auth.users.phone sync, section 5c)
- `POST /api/auth/phone-login/send` `{phoneE164, countryIso}` (ANONYMOUS, flag-gated) -> `{data:{sent,retryAfter}}` | `{error:{code,message}}` with `INVALID_PHONE` / `UNSUPPORTED_COUNTRY` / `IDENTITY_CONFLICT` / `ACCOUNT_BLOCKED` / `RESEND_TOO_SOON` / `SMS_PROVIDER_UNAVAILABLE` / `PHONE_LOGIN_NOT_AVAILABLE`
- `POST /api/auth/phone-login/verify` `{phoneE164, code, countryIso?}` (ANONYMOUS) -> `{data:{next,created}}` | `{error:{code,message}}` with `INVALID_CODE` / `EXPIRED_CODE` / `TOO_MANY_ATTEMPTS` / `IDENTITY_CONFLICT` / `ACCOUNT_BLOCKED` / `SESSION_CREATION_FAILED` / `PHONE_LOGIN_NOT_AVAILABLE`
- `AuthVerificationEvent` (Prisma) - audit trail AND the data behind the DB-backed rate limits
  (`src/lib/auth/rate-limit.ts`):
  - sends (email + phone): escalating resend cooldown 30s -> 60s -> 120s (then 120s),
    max 5 sends per identifier per hour; email also 10/h per IP hash
  - verifies: 5 invalid attempts per identifier or IP within 15 minutes ->
    locked for 15 minutes ("Too many attempts. Please try again in a few
    minutes."), audited as `otp_verify_locked`

### Field mapping (schema vs spec)

- `emailVerified DateTime?` = the spec's "email verified" boolean (timestamp set = true)
- `onboardingDone Boolean` = the spec's onboarding flag (already existed)
- `phoneE164` is canonical; legacy `phone`/`phoneVerified` are kept mirrored until retired


## Email OTP length

Supabase generates the email code at the length configured in
Authentication -> Email -> "Email OTP Length" (6-10 digits; GoTrue
`otp_length`). This project's dashboard was found set to 8, which made
6-box UI + `^\d{6}$` validation reject every real code. The app now
mirrors the dashboard through ONE setting - `NEXT_PUBLIC_EMAIL_OTP_LENGTH`
- consumed by the OTP boxes and the server validator alike; codes are
never generated, stored or truncated by the app. Recommended end
state: set the dashboard to 6 and drop the env override (6 is the
default). Until then production must run with
`NEXT_PUBLIC_EMAIL_OTP_LENGTH=8`. Phone codes stay 6 (Twilio Verify
service default).

## Pending auth users

Requesting an email OTP calls `signInWithOtp` with `shouldCreateUser: true`,
and Supabase creates the `auth.users` row BEFORE the code is ever entered.
That is GoTrue behavior and cannot be avoided without building a separate
pre-registration flow - the row is how Supabase ties the outstanding code
to an identity.

Tirvea therefore treats any `auth.users` row with **no confirmed email/phone
and no app `User` row** as a *pending signup attempt*, not an account:

- **Invisible in the product**: app `User` rows are created ONLY by
  `ensureAppUser()` (`src/lib/auth/identity.ts`), which runs from
  `/auth/callback` and `/api/auth/email/verify` strictly AFTER `verifyOtp`
  succeeds. No verified code, no account.
- **Invisible in the admin**: `src/app/admin/users` reads the Prisma `User`
  table only (`db.user.findMany`), so pending auth rows can never appear
  in any user list or count.
- **Swept after 24h**: `cleanupAbandonedAuthUsers()`
  (`src/lib/auth/cleanup.ts`) deletes `auth.users` rows where
  `email_confirmed_at IS NULL AND phone_confirmed_at IS NULL`, older than
  24 hours, with no `"User"` row and `is_sso_user = false`. All auth child
  tables (`identities`, `sessions`, `one_time_tokens`, `mfa_factors`, ...)
  cascade on delete, so one statement is sufficient. Each run is audited
  as an `auth_cleanup` `AuthVerificationEvent` with the deleted count.

### Why not `shouldCreateUser: false`?

It would break first-time registration outright: Supabase then refuses to
send a code to any email without an existing auth user, so new users could
never receive their first OTP. Sign-in and sign-up share one flow by
design; the ghost rows are the (bounded, swept) cost of that.

### Sweep scheduling

Two schedulers exist; either alone is enough, running both is harmless
(the DELETE is idempotent):

1. **pg_cron** (currently active on the live project): job
   `tirvea-auth-cleanup`, schedule `30 4 * * *`, runs the same guarded
   DELETE inside Postgres. Inspect with
   `SELECT * FROM cron.job WHERE jobname = 'tirvea-auth-cleanup';`
   (remove with `SELECT cron.unschedule('tirvea-auth-cleanup');`).
2. **Vercel Cron** (portable path): `vercel.json` schedules
   `GET /api/cron/auth-cleanup` daily at 04:30 UTC. The route requires
   `Authorization: Bearer <CRON_SECRET>` (Vercel sends this automatically
   when the `CRON_SECRET` env var is set) and fails closed when the env
   var is missing.

Admins can also trigger the sweep on demand: `POST /api/admin/auth-cleanup`
(permission `users:delete`, mirrored to `AdminLog` as `auth.cleanup`).
