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
| `SUPABASE_PHONE_ENABLED` | `"true"` ONLY once an SMS provider (Twilio) is configured in Supabase Phone Auth - see below |
| `DATABASE_URL` / `DIRECT_URL` | Supabase Postgres (pooled / direct) |

## 4. Email OTP template

Supabase -> Authentication -> Emails -> "Magic Link" template.
For the code-based flow the template **must contain `{{ .Token }}`** - that is
the 6-digit code the `/auth/email-code` screen asks for. A template with only
`{{ .ConfirmationURL }}` sends a link and no code, and code entry will always
fail. Recommended body: show `{{ .Token }}` prominently, keep
`{{ .ConfirmationURL }}` as a fallback link.

## 5. `SUPABASE_PHONE_ENABLED` - what the flag means

Phone verification is HONEST: we only demand a phone number when we can
actually verify one.

- `"true"`: Supabase -> Authentication -> Providers -> Phone is enabled with a
  live Twilio (or other) SMS provider. The auth gate
  (`src/lib/auth/gate.ts`) then requires a verified phone before onboarding,
  and email sign-ins from a new network re-challenge the phone.
- unset/anything else: the phone step is skipped everywhere; the phone API
  routes answer `503 "Phone verification is not available yet"`.

The phone is attached to the CURRENT signed-in user via the `phone_change`
flow (`auth.updateUser({ phone })` + `verifyOtp(type: "phone_change")`) - it
never creates a second, phone-keyed identity.

## 6. Auth flow map (code reference)

- `src/lib/auth/url.ts` - `siteUrl()` / `authRedirectUrl()`; the only way redirect URLs are built
- `src/app/auth/callback/route.ts` - OAuth/magic-link callback; idempotent against re-used codes
- `src/lib/auth/identity.ts` - `ensureAppUser()`: the single app-User provisioning path (callback + email verify)
- `src/lib/auth/gate.ts` - `authNextStep()`: blocked -> email -> phone (if enabled) -> onboarding -> app
- `POST /api/auth/email/send` `{email}` -> always `{ok:true}` (neutral; disposable/limited differ only in audit)
- `POST /api/auth/email/verify` `{email, code}` -> `{ok:true, next}` or neutral failure
- `POST /api/auth/phone/send` `{phoneE164, countryIso?, dialCode?}` (session required)
- `POST /api/auth/phone/verify` `{phoneE164, code}` -> `{ok:true, next}`
- `AuthVerificationEvent` (Prisma) - audit trail AND the data behind the DB-backed rate limits
  (email send 5/h/email + 10/h/IP, phone send 3/h/number, 8 failed verifies/h -> block)

### Field mapping (schema vs spec)

- `emailVerified DateTime?` = the spec's "email verified" boolean (timestamp set = true)
- `onboardingDone Boolean` = the spec's onboarding flag (already existed)
- `phoneE164` is canonical; legacy `phone`/`phoneVerified` are kept mirrored until retired
