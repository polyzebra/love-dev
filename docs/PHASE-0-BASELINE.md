# Phase 0 — Baseline & Safety Record (Phase 0A)

Baseline commit: **`bb11a60`** ("Remove hero trust-badge row").
Recorded: 2026-07-13. No production code changes in this document's commit.

Phase 0 objective: platform independence at the API, authentication,
realtime, notification and deployment layers — web behaviour preserved,
future Bearer-token clients enabled, no Capacitor/Expo/native code.

---

## 1. Toolchain baseline

| Check | Result |
|---|---|
| `npx tsc --noEmit` | CLEAN — 0 errors |
| `npm run lint` | 0 errors, 2 pre-existing warnings (`(app)/layout.tsx` unused `db`, `privacy-actions.tsx` unused `router`) |
| `npm run build` | Compiles clean (Next 16.2.10, webpack), 0 errors |
| Working tree | clean at `bb11a60` |

### Test baseline — 25/25 suites pass (exit 0)

Run individually via `npx tsx tests/<file>` against the real `.env` DB.

| Suite | Result | Suite | Result |
|---|---|---|---|
| admin-authz | 15 passed, 1 skipped | notifications-web-surface | 15 |
| age-consent | 16 | otp-policy | 29 |
| auth-cleanup | 9 | phone-countries | 22 |
| auth-form-stack | 42 | phone-login | 15 |
| auth-hardening | 25 | phone-release | 15 |
| auth-url | 13 | phone-sync | 14 |
| billing-ui | 51 | phone-verification | 14 |
| billing | 69 (4 route-401 checks skip without dev server) | photo-pipeline | 5 (route E2E section env-gated) |
| email-attach | 13 | risk-scam-engines | 28 |
| identity-event | 4 | safety-email | 15 |
| identity-invariants | 8 | safety-ops | 28 |
| login-routes | 9 | trust-safety | 44 |
| notifications | 30 | **Total** | **≈549 checks** |

### Bundle composition (client)

- Total client JS: **3,824 KB** across `.next/static/chunks` (largest:
  284 / 240 / 224 KB, four ~164 KB route chunks); CSS 192 KB.
- `next/dynamic`: 0 usages. `React.lazy`: 0. `motion/react` imported in
  28 component files (ships eagerly). `libphonenumber-js` in client
  bundle (phone input).

---

## 2. Inventories

### API routes — 90 `route.ts` under `src/app/api/**`

| Group | Routes | Guard |
|---|---|---|
| auth (OTP send/verify: email, phone, phone-login, email-attach; consent, age-confirm, identity-event) | 11 | public OTP entries behind fail-closed limits; rest `requireSession` |
| account (delete, export, status) | 3 | `requireSession` (status: `allowRestricted`) |
| billing (checkout, checkout-status, portal, resume, retry-payment, change-plan +preview +status) | 8 | `requireSession` |
| swipes / discover / matches / first-messages / explore / me | 10 | `requireSession` |
| conversations / messages / presence | 4 | `requireSession` |
| profile / onboarding / photos / media / verification | 10 | `requireSession` |
| blocks / reports / appeals | 6 | `requireSession` (appeals: `allowRestricted`) |
| push (status, subscribe, unsubscribe, test) + analytics | 5 | `requireSession` |
| admin/** | ~26 | `requirePermission(<perm>)`; `admin/bootstrap` header-secret |
| cron (auth-cleanup, notifications) | 2 | `Authorization: Bearer ${CRON_SECRET}` |
| webhooks (stripe, email/Svix, supabase-auth, verification) | 4 | signature over raw body |
| health, version-adjacent | 1 | public |

Response envelope: `{data}` / `{error:{code,message,fields?}}` via
`src/lib/api.ts` helpers everywhere EXCEPT auth OTP send/verify routes
(`{ok, retryAfter}` / `{ok:false, error}` from `withUnavailableGuard`)
and cron (`{error:{code}}` partial). No versioning (`/api/*`).

### Server actions — 4 files, 10 exported actions (not HTTP-addressable)

- `src/app/(app)/settings/actions.ts` — `saveSettings`
- `src/app/(app)/settings/support-actions.ts` — `restorePurchases`
- `src/app/(app)/profile/prompts/actions.ts` — `saveProfilePrompts`
- `src/app/admin/actions.ts` — `setUserStatus`, `resolveReport`,
  `reviewVerification`, `toggleFeatureFlag`, `toggleExploreCategory`,
  `moveExploreCategory`, `updateExploreCategory`

### Authentication entry points

- **Session resolution (server):** `src/lib/auth.ts` `auth()` →
  `supabaseServer()` (`src/lib/supabase/server.ts`, cookie jar from
  `next/headers`) → `supabase.auth.getUser()` → `db.user.findUnique`.
  **Cookie-only; no Authorization: Bearer path exists** (verified: only
  Bearer acceptance in the repo is the cron shared secret).
- **Route guard:** `src/lib/api.ts` `requireSession` / `requirePermission`.
- **Page guard:** `src/lib/auth/require-user.ts` (`next/navigation`).
- **Edge:** `src/proxy.ts` — cookie refresh via `getClaims()`, protected-
  route gate, signed-in `/login` reverse-gate. Matcher excludes `/api`.
- **Sign-in flows:** email OTP (`auth/email/*` + `EmailInputStep`),
  phone-login OTP (`auth/phone-login/*` + `PhoneLoginInput`), OAuth
  Google/Apple (`LoginEntry` → `supabaseBrowser().auth.signInWithOAuth`
  → `/auth/callback`), email-attach + phone-attach steps, recovery.
  Session cookies are minted by the verify routes through the SSR client.

### Polling locations (setInterval/poll)

- **`src/components/app/chat-thread.tsx`** — THE realtime gap:
  `POLL_INTERVAL_MS = 5000` message poll (:153-185) +
  10s presence heartbeat (:147). `DELIVERED` status dead code awaiting
  a real transport.
- Legitimate UI timers (NOT realtime debt, unchanged in Phase 0):
  `ResendTimer.tsx` (countdown), `PhoneLoginCode.tsx:106` (resend),
  `checkout-confirm.tsx` (2s×25s payment reconciliation poll),
  `upgrade-plan-button.tsx` (30s upgrade-status poll — server-truth
  polling by design), `auth-debug-panel.tsx` (temporary diagnostics).

### Notification transport locations

- Server: `src/lib/services/push.ts` (web-push/VAPID behind injectable
  `setPushTransport`), `notify.ts` (transactional outbox, quiet hours,
  per-type prefs; `sendPushToUser` fan-out), `email.ts` (Resend +
  outbox), `safety-notices.ts` (templates).
- Client/browser: `src/lib/notifications/{capabilities,platform,push,register}.ts`
  ("use client", service-worker + Notification API), `public/sw.js`
  (push display + click routing only, NO fetch handler).
- Schema: `PushSubscription` (endpoint+p256dh+auth — Web Push shape),
  `NotificationDelivery.idempotencyKey`, `UserSettings.inAppSounds/
  inAppVibrations` (native-only columns, already accepted by
  `settingsPatchSchema`). Native plan documented in
  `docs/NOTIFICATIONS-NATIVE.md`.

### Rate-limit implementations

- `src/lib/rate-limit.ts` — generic sliding window, **in-memory
  MemoryStore, per-instance, effectively fail-open**; presets for
  login/register/otp/swipe/message/report/api/push/billing; applied via
  `guardRate` in routes. (Self-documents the Redis swap seam.)
- `src/lib/auth/rate-limit.ts` — OTP send/verify limits **DB-backed on
  `AuthVerificationEvent`, shared across instances, fail-closed** via
  `withUnavailableGuard`. Not changing in Phase 0.

### CI / deployment

- **No CI exists** (no `.github/workflows`; `vercel.json` = crons only).
  Push to `main` deploys production directly via Vercel.

---

## 3. Dependency maps (import direction, verified: 0 lib→app/components imports, 0 src cycles)

**Auth:** components/auth/* → `/api/auth/*` routes → `lib/auth/{otp,phone-flow,phone-login-flow,email-attach-flow,rate-limit,audit,gate,consent,risk,identity}` → `lib/db`, `lib/supabase/server`(cookies), `lib/mailer`. `auth()` ← consumed by `lib/api.requireSession`, `lib/auth/require-user`, pages. Edge: `proxy.ts` → `@supabase/ssr` only.

**API layer:** routes → `lib/api` (envelope+guards) → `lib/auth.ts`; routes → `lib/validators/*` (zod) → `lib/services/*`. No service imports Next request APIs (verified; exceptions live in `lib/supabase/server`, `lib/auth/device`, `lib/auth/require-user` — the seams themselves).

**Billing/subscriptions:** routes `/api/billing/*` + webhook → `services/billing` → `lib/stripe` (REST client, injectable), `lib/db`, `lib/constants` (PLANS hierarchy) → read by `services/entitlements` (`effectiveTier`) ← consumed by `services/matching`, `first-messages`, pages. `Subscription.provider` enum ready for a second provider.

**Chat:** `chat-thread.tsx` → `/api/conversations/[id]/messages` + `/api/presence/heartbeat` → `services/chat` (`assertParticipant`, send/read) → db. First-messages: `/api/first-messages*` → `services/first-messages` → `services/chat`, `entitlements`, `notify`.

**Notifications:** domain events → `services/notify` (outbox) → `services/push` (web-push transport, injectable) + `services/email`; delivery cron `/api/cron/notifications`. Client: `lib/notifications/*` → `/api/push/*` routes.

**Trust & safety:** `/api/reports|blocks|appeals` + admin routes/actions → `services/{trust-safety,trust-engine,moderation,moderation-providers,fraud-signals,scam,appeals,user-admin,safety-notices}` → db + `lib/audit`. Status predicates consumed by discovery/chat/photos.

**Media:** `/api/photos*` → `services/photos` (sharp pipeline, private bucket) ; `/api/media/[photoId]/[variant]` (auth proxy, `canViewPhoto`) → supabase storage via cookie-scoped server client. Delivery therefore inherits the cookie transport.

**Subscriptions of pages on services:** 30 `page.tsx` files also query prisma directly (read models; one mutating render side-effect in `notifications/page.tsx:25-32`) — recorded as pre-existing; Phase 0 does not relocate them except where a workstream touches the file anyway.

---

## 4. Exact files expected to change in Phase 0

**WS1 — Bearer authentication (dual transport, cookie behaviour preserved):**
`src/lib/supabase/server.ts` (accept `Authorization: Bearer` alongside cookies), `src/lib/auth.ts` (transport-agnostic resolution), `src/lib/api.ts` (no contract change; tests), `src/proxy.ts` (no interference confirmation), new tests `tests/bearer-auth.test.ts`. Media proxy inherits automatically via `requireSession`.

**WS2 — API v1 + envelope unification (no silent contract change; `/api/*` kept as alias during deprecation):**
`next.config.ts` (rewrites `/api/v1/:path*` → `/api/:path*`), `src/lib/api.ts` (envelope helpers for auth-send shape), `src/app/api/auth/email/send/route.ts`, `auth/phone-login/send/route.ts`, `auth/phone/send/route.ts`, `auth/email-attach/send/route.ts` (+verify siblings) — additive envelope (`data` alongside legacy `ok` until clients migrate), cron routes' error shape; client callers `src/components/auth/api.ts`/steps updated in the same commit; contract doc `docs/API-CONTRACT.md`.

**WS3 — Server actions → routes (actions become thin wrappers over services; new routes call the same services):**
new `src/app/api/me/settings/route.ts`, `src/app/api/me/profile-prompts/route.ts`, `src/app/api/billing/restore/route.ts`, `src/app/api/admin/{flags,explore-categories,…}` route additions; `src/lib/services/profile-prompts.ts` (extract the `$transaction` from the action), `src/app/admin/actions.ts` + the three app action files reduced to service calls (web UI keeps using actions; routes expose the same services to HTTP).

**WS4 — Push multi-transport:**
`prisma/schema.prisma` + migration (transport discriminator / native token shape on `PushSubscription` — additive, default `WEBPUSH`), `src/lib/services/push.ts` (transport registry: webpush now; apns/fcm stubs behind the existing injectable seam), `src/app/api/push/subscribe/route.ts` (accept typed payloads), `src/lib/validators/push.ts`, `tests/notifications.test.ts` extensions.

**WS5 — Chat realtime (replace 5s polling; polling stays as fallback until verified):**
`src/lib/services/chat.ts` (emit), new `src/lib/realtime.ts` (transport seam — Supabase Realtime broadcast, server-publish), `src/components/app/chat-thread.tsx` (subscribe + fallback), `src/app/api/conversations/[conversationId]/messages/route.ts` (publish on send), presence heartbeat unchanged initially.

**WS6 — Distributed rate limiting:**
`src/lib/rate-limit.ts` (store interface + Upstash/Redis REST store, memory fallback for dev; fail-policy made explicit per preset), `src/lib/env.ts` (+2 vars), `.env.example`, `tests/rate-limit.test.ts` (new).

**WS7 — CI:**
new `.github/workflows/ci.yml` (typecheck, lint, build, unit-safe test subset; DB-backed suites gated on secrets), `package.json` (`test` script + runner loop), no runtime code.

Rollback conventions for every WS: single-commit revert restores prior behaviour (`git revert <sha>`); WS2/WS4 are additive-first (aliases/columns with defaults) so reverts are non-breaking; WS1 keeps cookies primary — removing Bearer acceptance is a one-file revert; WS5 keeps polling code path behind a flag until the transport is production-verified.

## 5. Confirmation

**No mobile-specific code is required for Phase 0.** Every workstream is
server/web-repo work: no Capacitor/Expo/React Native packages, no `ios/`
or `android/` directories, no mobile UI. The only mobile-*adjacent*
artifacts are additive schema/validator shapes for future native push
tokens (WS4), which are plain Postgres columns and zod unions.

## 6. Verification protocol (applies to every Phase 0 commit)

1. `npx tsc --noEmit` clean; `npm run lint` 0 errors; `npm run build` clean.
2. Full test sweep (`for t in tests/*.test.ts; do npx tsx $t; done`) — no
   suite may regress from the table in §1.
3. Behaviour-preservation spot-checks per WS (documented in each commit
   message): e.g. WS1 = existing cookie session still authenticates all
   sampled routes + new bearer test passes; WS2 = legacy clients parse
   unchanged fields.
4. Production verification after deploy: health endpoint, one guarded
   route via cookie AND (post-WS1) via bearer, webhook signature still
   enforced.
