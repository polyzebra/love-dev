# Auth setup - production checklist

Everything the Supabase/Google/Vercel dashboards must contain for Tirvea's
auth to work in production. Code-side conventions live at the bottom.

## 1. Supabase - Authentication -> URL Configuration

| Setting | Value |
| --- | --- |
| Site URL | `https://tirvea.com` |
| Redirect URLs | `https://tirvea.com/**` |
| | `https://tirvea.com/auth/callback` |
| | `https://tirvea.com/auth/confirm` |
| | `http://localhost:3000/**` (dev only - REMOVE for launch review) |

Every OAuth/magic-link redirect the app requests is built from
`NEXT_PUBLIC_SITE_URL` (see `src/lib/auth/url.ts`) - if a login loops back to
`localhost` in production, that env var is missing, not this list.

## 2. Google Cloud Console (OAuth client)

- APIs & Services -> Credentials -> your OAuth 2.0 Client ID
- **Authorized redirect URI** (the ONLY one needed):
  `https://<project-ref>.supabase.co/auth/v1/callback`
- Paste the client id + secret into Supabase -> Authentication -> Providers -> Google.
- The app always sends `prompt=select_account`, so account switching after
  sign-out is explicit.

## 3. Vercel environment variables

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | `https://tirvea.com` - canonical origin for every auth redirect |
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

Supabase -> Authentication -> Emails -> "Magic Link" template.
For the code-based flow the template **must contain `{{ .Token }}`** - that is
the 6-digit code the `/auth/email-code` screen asks for. A template with only
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

## 6. Auth flow map (code reference)

- `src/lib/auth/url.ts` - `siteUrl()` / `authRedirectUrl()`; the only way redirect URLs are built
- `src/app/auth/callback/route.ts` - OAuth/magic-link callback; idempotent against re-used codes
- `src/lib/auth/identity.ts` - `ensureAppUser()`: the single app-User provisioning path (callback + email verify)
- `src/lib/auth/gate.ts` - `authNextStep()`: blocked -> email -> phone (if enabled) -> onboarding -> app
- `POST /api/auth/email/send` `{email}` -> always `{ok:true, retryAfter}` (neutral; disposable/limited differ only in audit - `retryAfter` = seconds until the resend unlocks)
- `POST /api/auth/email/verify` `{email, code}` -> `{ok:true, next}` or neutral failure
- `POST /api/auth/phone/send` `{phoneE164, countryIso?, dialCode?}` (session required) -> `{ok:true, retryAfter}` (limited sends are indistinguishable from real ones)
- `POST /api/auth/phone/verify` `{phoneE164, code}` -> `{ok:true, next}`
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
