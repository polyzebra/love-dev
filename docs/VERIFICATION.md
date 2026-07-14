# Photo Verification (Stripe Identity go-live)

Architecture is unchanged from the audited design: ONE start endpoint
(`POST /api/verification/photo/start`), ONE poll endpoint
(`GET /api/verification/photo/status`), ONE webhook
(`POST /api/webhooks/verification`), canonical verdict on
`User.photoVerifiedAt`, Verification rows as workflow state only.

## Provider: Stripe Identity (live adapter)

`src/lib/services/photo-verification.ts` - fetch-based like the billing
client (the project carries no Stripe SDK), injectable transport for
tests.

- **createSession**: `POST /v1/identity/verification_sessions` with
  `type=document` + `require_matching_selfie` + `require_live_capture`;
  metadata carries ONLY `tirvea_user_id` (never email/phone/PII);
  `return_url` -> `/profile#photo-verification`. Returns the hosted URL
  - opaque session id.
- **getStatus** mapping: `verified->approved`, `processing->pending`,
  `canceled->expired`, `requires_input` -> `rejected` when `last_error`
  is present, otherwise `pending` (an unfinished flow is never a verdict).
- **handleWebhook**: official Stripe signature scheme over the RAW body
  (`verifyStripeSignature`, shared with billing) with the DEDICATED
  `STRIPE_IDENTITY_WEBHOOK_SECRET`. Only
  `identity.verification_session.*` events are consumed; anything else
  maps to the `pending` no-op so Stripe never retry-loops. Outcomes flow
  through the same idempotent `applyVerificationOutcome` as polling.

## Privacy promise (unchanged, enforced)

Stripe hosts capture and holds the images. Tirvea stores the provider
name, the opaque session id and the outcome - never documents, selfies
or biometric data. Return from the hosted flow never marks anyone
verified; only webhook/poll reconciliation stamps the canonical verdict.

## Environment

| Var                              | Purpose                                                                     |
| -------------------------------- | --------------------------------------------------------------------------- |
| `VERIFICATION_PROVIDER`          | `stripe_identity` (prod) / `mock` (dev only - refused in production builds) |
| `STRIPE_SECRET_KEY`              | shared with billing                                                         |
| `STRIPE_IDENTITY_WEBHOOK_SECRET` | dedicated Identity webhook endpoint secret                                  |
| `VERIFICATION_WEBHOOK_SECRET`    | mock-provider webhook HMAC (dev/tests)                                      |

All three prod vars must be present or availability stays false (503,
"Coming soon" UI). Register the Stripe webhook endpoint at
`https://tirvea.com/api/webhooks/verification` subscribed to exactly
`identity.verification_session.verified`, `.requires_input`,
`.processing`, `.canceled` - TEST MODE first. Test and live mode issue
DIFFERENT endpoint secrets (`whsec_...`): set the test-mode secret in
`STRIPE_IDENTITY_WEBHOOK_SECRET` for the rehearsal, then swap in the
live-mode secret (never billing's webhook secret) at go-live.

Test-user lifecycle for E2E rehearsals:
`npx tsx scripts/reset-test-user.ts <email>` audits (dry run by
default); `--confirm` deletes. Refuses anything but obvious test
identities (@example.com, @test.tirvea.app, test-/e2e-/qa- prefixes,
+test aliases).

## Developer workflows (deterministic env, 2026-07-14)

One key = ONE line in `.env` - loaders disagree on duplicates (Next.js
keeps the LAST value, dotenv/tsx/Prisma keep the FIRST), so duplicated
keys silently run different values in different tools. Overrides go in
the PROCESS env (npm scripts), which every loader respects.

- **Local mock (default)**: `npm run dev` - `.env` pins
  `VERIFICATION_PROVIDER="mock"`. Full state machine, signed mock
  webhooks, zero external calls. `npm test` exercises the HTTP loops
  against this server (suites skip them if the server isn't mock;
  `TEST_ASSUME_MOCK=1` opts a purpose-launched mock server back in).
- **Local live (explicit opt-in)**: `npm run dev:live` - process env
  sets `VERIFICATION_PROVIDER=stripe_identity` +
  `ALLOW_LIVE_VERIFICATION=1`. Without that flag, a LIVE key
  (`sk_live_`) outside production is refused at provider selection
  (sessions bill real money). Note: Stripe webhooks land on the
  PRODUCTION endpoint, so local live completion arrives via the status
  poll/reconciler, not webhooks.
- **Production**: all config in Vercel env (never `.env`);
  `NODE_ENV=production` needs no flag. Mock is refused in production
  builds; a partial config stays honestly unavailable (503).

## Session reuse (2026-07-14)

`POST /api/verification/photo/start` RESUMES before it creates: an open
session at the provider (Stripe `requires_input`/`processing`) returns
the SAME session id and its still-active hosted URL (`reused: true`) -
one user never accumulates duplicate VerificationSessions. A new session
is created only when none exists or the previous one is terminal
(canceled / expired / rejected). The status endpoint exposes the raw
provider sub-state + reopenable URL (`session: {providerStatus, url}`)
so the card can say "Complete your verification / Continue verification"
(requires_input) vs "Verification in progress / Check status"
(processing) honestly - both remain ONE canonical "pending" state.

## UX

One flow: `PhotoVerifyCard` on `/profile`, anchored at
`#photo-verification` (focusable, `tabIndex=-1`). The profile trust row
anchors in-page; Settings deep-links to `/profile#photo-verification`;
unconfigured environments show a quiet "Coming soon" state with no CTA
anywhere. Shared presentation: `VerificationStatusRow` (profile +
settings) and `VerifiedBadge` (person-card, profile-peek; the explore
viewer keeps its distinctive animated badge deliberately).

## Tech debt (documented)

Rejection FINALITY is inferred by `isFinalRejection(reviewNote)` - the
marker word "final" in a staff review note. Nothing writes it
automatically; every provider rejection is retryable by design. Promote
to a dedicated column when a second writer needs it.

## Tests

`tests/photo-verification.test.ts` (22 checks): config gates incl.
mock-refused-in-production, adapter request shape/metadata/return_url,
full status+event mapping, real signature accept/reject, unrelated-event
no-op, finality rule, UX/navigation pins, and the full HTTP loop (start
-> forged-webhook 401 no-mutation -> approved -> canonical stamp ->
duplicate idempotent -> 409 restart -> status verified).
`tests/verification-e2e-guards.test.ts` (12 checks): unknown-Stripe-state
safety, wrong-provider session no-op, explore-profile target regression
(the where-clobber the E2E caught), reset-CLI allowlist/dry-run/confirm
lifecycle.
