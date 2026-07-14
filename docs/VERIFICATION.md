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
`https://tirvea.com/api/webhooks/verification` with the
`identity.verification_session.*` events, TEST MODE first.

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
