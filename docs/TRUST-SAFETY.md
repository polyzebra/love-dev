# Trust & Safety - architecture, flows, operations

Single reference for the Tirvea Trust & Safety platform: how content is
moderated, how enforcement and appeals work, how staff run the queues, and
what to do when something external breaks. Code is the source of truth -
every section links the file that owns the behavior.

---

## 1. Architecture map

### Models (prisma/schema.prisma)

| Model                   | Purpose                                                                                                                                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ModerationCase`        | One investigation about one user. Dedupe: at most one OPEN/UNDER_REVIEW case per (user, caseType); new signals append to the evidence trail. Carries the SLA fields (`priority`, `slaDueAt`, `assignedToId`, `firstResponseAt`, `resolvedAt`, `lastActivityAt`, `escalatedAt`). |
| `PhotoModerationResult` | Automated provider output for one photo - scores only, PII-stripped, no biometrics ever.                                                                                                                                                                                        |
| `AccountViolation`      | One enforcement action. `userVisibleReason` is the ONLY reason text a user ever sees; `internalReason` stays staff-side. `reversedAt` marks reversal.                                                                                                                           |
| `Appeal`                | One appeal against one violation. `adminNotes` is staff-only and never selected into user read models (asserted in tests).                                                                                                                                                      |
| `AppealEvent`           | Append-only appeal timeline. `note` is USER-VISIBLE copy by contract.                                                                                                                                                                                                           |
| `BannedCredential`      | Ban-evasion blocklist: verified E.164 phone + salted device hash only.                                                                                                                                                                                                          |
| `SuppressedEmail`       | Addresses we must never email again (hard bounce / complaint / manual).                                                                                                                                                                                                         |
| `ProviderHealth`        | Rolling per-provider success/failure counters, written by the fallback chains.                                                                                                                                                                                                  |
| `Verification`          | External identity/photo verification references - documents are never stored.                                                                                                                                                                                                   |

### Services (src/lib/services/)

| File                      | Owns                                                                                                                                                                                                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trust-safety.ts`         | Status-ladder predicates, case open/dedupe, SLA policy (`CASE_SLA_HOURS`), assignment/claim, overdue escalation, graduated enforcement ladder, direct (human) actions, reversal, ban credentials, user-visible copy.                                                        |
| `appeals.ts`              | Appeal lifecycle (submit/decide/withdraw/needs-info/respond/expiry), the user account-status read model, staff list read models (`listModerationCases` incl. search/priority/assignee/overdue filters + `countModerationCases`, `listAppeals`), provider-health read model. |
| `moderation.ts`           | Photo decision engine (`decidePhotoSafety`, `PHOTO_SAFETY_THRESHOLDS`), provider selection, pipeline entry.                                                                                                                                                                 |
| `moderation-providers.ts` | External provider adapters (OpenAI, Google Vision, Hive; documented Rekognition/Azure stubs) + the ordered fallback chain + ProviderHealth writes.                                                                                                                          |
| `email.ts`                | Email transport abstraction (Resend adapter, honest not-configured provider), Svix-style webhook signature verification.                                                                                                                                                    |
| `safety-notices.ts`       | Every user-facing T&S notification template (`SAFETY_NOTICE_COPY`), delivered through the notify outbox.                                                                                                                                                                    |
| `notify.ts`               | Outbox: in-app rows always; EMAIL/PUSH delivery rows drained by cron with backoff; suppression checks.                                                                                                                                                                      |
| `fraud-signals.ts`        | Pure fraud signal scorers (`FRAUD_WEIGHTS`) - device reuse, velocity, alias reuse, IP intel, scam lexicon.                                                                                                                                                                  |
| `trust-engine.ts`         | Composite safety risk score (`TRUST_ENGINE_WEIGHTS`), score -> recommended action mapping, persisted on `User.safetyRiskScore`.                                                                                                                                             |

### Routes

User (restricted-tolerant - suspended/banned users may manage appeals):

- `GET /api/account/status` - the full user read model (status card, violations, appeal + timeline).
- `POST /api/appeals` - submit; `POST /api/appeals/[id]/withdraw`; `POST /api/appeals/[id]/respond {message}`.
- `POST /api/appeals/[id]/attachments` - honest 501 until `APPEAL_ATTACHMENTS_ENABLED` ships.

Staff (`requirePermission`; moderators hold `safety:read`, admins `safety:manage`):

- `GET /api/admin/safety/cases` (`status/severity/priority/assignedTo/overdue/q`, returns `{cases,total}`), `POST .../cases/[id]/review|assign|claim`.
- `GET /api/admin/safety/appeals` (all 8 statuses), `POST .../appeals/[id]/decide|needs-info|under-review`.
- `POST /api/admin/safety/users/[id]/enforce|require-verification`, `POST .../violations/[id]/reverse`.
- `GET /api/admin/safety/providers` - provider chain + email transport + health (names only, never keys).

Webhooks and cron:

- `POST /api/webhooks/email` - Resend delivery events (signed, idempotent).
- `POST /api/webhooks/verification` - provider verification results (signed, idempotent).
- `GET /api/cron/notifications` - outbox drain + SLA escalation + appeal expiry (Bearer `CRON_SECRET`, fails closed).

Pages: user Appeals Centre under `/account/status`, `/account/appeals[/violationId]`,
`/account/community-resources`; staff console under `/admin/trust-safety`,
`/admin/moderation-cases[/id]`, `/admin/appeals`, plus `/admin/photos`,
`/admin/reports`, `/admin/verification`.

---

## 2. Moderation flow (photo upload -> enforcement)

1. **Upload** (`POST /api/photos`) - `assertUploadAllowed` gate first (status ladder + unexpired UPLOAD_BLOCKED violations).
2. **Provider chain** - `MODERATION_PROVIDERS` is an ordered comma list (e.g. `openai,google_vision,hive`). Each adapter has a hard timeout; a failure writes `ProviderHealth` and falls through to the next. **If every provider fails the photo goes to `needs_review` - never auto-approved.**
3. **Decision engine** - `decidePhotoSafety` maps scores to a severity/action with one visible threshold table:

   | Constant           | Value | Meaning                                                             |
   | ------------------ | ----- | ------------------------------------------------------------------- |
   | `minorCritical`    | 0.60  | `minorRiskScore` at/above = CRITICAL (`MINOR_SAFETY`), always first |
   | `minorWithAdult`   | 0.40  | "minors" label + this much adult content = CRITICAL                 |
   | `explicitCritical` | 0.97  | near-certain explicit = CRITICAL, policy-critical                   |
   | `high`             | 0.85  | adult/violence/stolen at/above = HIGH -> photo hidden + case        |
   | `medium`           | 0.60  | any category at/above = MEDIUM -> stays visible, human review case  |

   A provider's own "rejected/review" verdict can only escalate severity, never soften it.

4. **Enforcement ladder** (`graduatedActionFor`) - counted over non-reversed violations:

   | Prior violations | Photo context       | No photo context |
   | ---------------- | ------------------- | ---------------- |
   | 0                | PHOTO_REMOVED       | WARNING          |
   | 1                | UPLOAD_BLOCKED (7d) | LIMITED (7d)     |
   | 2                | LIMITED (7d)        | LIMITED (7d)     |
   | 3+               | SUSPENDED           | SUSPENDED        |

   Policy-critical signals (minors / near-certain explicit / impersonation) with confidence >= 0.8 (`POLICY_CRITICAL_CONFIDENCE`) suspend immediately **pending human review**. Automation never bans - `BANNED` exists only on the human path (`applyDirectAction`).

5. **Notification** - every action queues a calm `SAFETY_NOTICE_COPY` notice through the outbox (in-app always; email/push per user preferences and transport honesty).

## 3. Appeals flow

Eight states (`AppealStatus`):

```
SUBMITTED (= legacy PENDING_REVIEW)
  -> UNDER_REVIEW        staff started the review
  -> NEEDS_INFO          staff asked the user a question (user-visible)
       -> UNDER_REVIEW   user sent their ONE reply
       -> EXPIRED        no reply within 14 days (system close, re-appeal allowed)
  -> APPROVED            violation REVERSED (status recomputed, photos restored,
                         ban credentials lifted when no ban remains) - final
  -> REJECTED            action stays in force - final for that violation
  -> WITHDRAWN           user withdrew pre-decision (re-appeal allowed)
```

Rules (all enforced in `appeals.ts`, transaction + CAS):

- One open appeal per violation; a decided appeal is final; WITHDRAWN/EXPIRED free a fresh appeal (`canAppeal` true again).
- Max 3 appeals per account per rolling day, plus route rate limits.
- Every transition writes an `AppealEvent`; `note` is user-visible (the needs-info question, the user's reply, the system expiry line). Staff-private commentary lives in `Appeal.adminNotes` only.
- `respondBy` = `needsInfoRequestedAt + 14d` (`NEEDS_INFO_EXPIRY_DAYS`); expiry runs lazily per user and globally via cron.
- The user UI renders the timeline verbatim from `GET /api/account/status`; the staff queue renders the same events plus internals.

## 4. Risk / fraud engine

`computeTrustProfile` (trust-engine + fraud-signals) composes pure scorers; a
missing provider means an absent signal, never a default.

| Signal (`FRAUD_WEIGHTS`)                              | Points      |
| ----------------------------------------------------- | ----------- |
| Device hash shared with 1 other account               | 20          |
| Device hash shared with 2+ accounts                   | 30          |
| 2+ signups on device within 7d                        | 15          |
| 3+ / 6+ identities per IP in 24h                      | 10 / 20     |
| Email alias reuse (normalized)                        | 25          |
| 6+ OTP failures in 7d                                 | 15          |
| Provider verification rejected 2+ times               | 15          |
| Verified phone on ban blocklist                       | 30          |
| VPN / TOR (real IP intel only)                        | 10 / 20     |
| Scam-lexicon phrase / contact handle / hollow profile | 15 / 10 / 5 |

Plus `TRUST_ENGINE_WEIGHTS`: photos rejected (10 ea, cap 30), distinct
reporters (10 ea, cap 30), violations (15 ea, cap 45), admin flag 30,
disposable email 10, high login risk 10, refunded payment 10, and 30% of the
behavioural `scamScore`.

Score bands -> recommended action (`recommendedActionFor`, mirrored on the
admin dashboard distribution):

| Band   | Recommendation                                            |
| ------ | --------------------------------------------------------- |
| 0-14   | none                                                      |
| 15-29  | SHOW_WARNING                                              |
| 30-44  | REQUIRE_PHOTO_VERIFICATION (photo signals) / SHOW_WARNING |
| 45-54  | LIMIT_MESSAGING (scam/reported) / HIDE_PROFILE            |
| 55-69  | SEND_TO_MANUAL_REVIEW                                     |
| 70-84  | SUSPEND_ACCOUNT                                           |
| 85-100 | BAN_ACCOUNT (recommendation only - a human decides)       |

Recommendations are surfaced on the user admin page and case detail; they
never auto-apply.

## 5. Email events

Templates (`SAFETY_NOTICE_COPY` in safety-notices.ts): `warning`,
`photo_removed`, `photo_approved`, `verification_required`,
`verification_approved`, `verification_rejected`, `limited`, `suspended`,
`banned`, `restriction_lifted`, `restriction_extended`, `appeal_submitted`,
`appeal_approved`, `appeal_rejected`, `appeal_needs_info`,
`appeal_withdrawn`, `appeal_expired`.

Delivery lifecycle (notify.ts outbox + email.ts transport):

```
Notification row (in-app, always)
  -> EMAIL NotificationDelivery PENDING
  -> worker (cron): suppression check -> provider send
       accepted            -> SENT (provider message id kept)
       429/5xx/network     -> retry with backoff, then FAILED (durable)
       4xx permanent       -> FAILED immediately
       no RESEND_API_KEY   -> DEAD errorCode "not_configured" (honest)
  -> webhook advances SENT -> DELIVERED / BOUNCED / COMPLAINED
       hard bounce / complaint -> SuppressedEmail row (never emailed again;
       rows removed only by deliberate admin action)
```

Webhook setup (Resend):

1. Resend dashboard -> Webhooks -> add endpoint `https://<host>/api/webhooks/email`, subscribe to `email.delivered`, `email.bounced`, `email.complained`.
2. Copy the signing secret (`whsec_...`) into `RESEND_WEBHOOK_SECRET`.
3. Signature is Svix-style (`{id}.{timestamp}.{rawBody}`, constant-time compare, 5-minute tolerance). Unsigned/bad/replayed events are rejected; processing is idempotent by provider message id, so Resend's own retries and manual replays are safe.

## 6. Admin manual

**Queues.** `/admin/trust-safety` is the landing dashboard (queues, ops
metrics, provider health). `/admin/moderation-cases` is the case queue:
filter by status/severity/priority/assignee/overdue, search by user email,
user id or case id (server-side), select rows for bulk assign-to-me /
bulk dismiss (one reason, per-item audit). `/admin/appeals` is the appeal
queue with all eight statuses and the full timeline per appeal.

**SLA policy** (`CASE_SLA_HOURS`, single source trust-safety.ts): first
response due 4h (CRITICAL), 24h (HIGH), 72h (MEDIUM), 168h (LOW), measured
from case creation against `priority` (defaults to severity).
`firstResponseAt` stamps on the first staff action (claim/assign/review);
`resolvedAt` on terminal decisions. Overdue = past `slaDueAt`, unresolved,
still open.

**Assignment.** Claim (safety:read) is self-service and never steals a held
case. Assigning someone else or unassigning is queue management ->
safety:manage. Workload per assignee is on the dashboard.

**Escalation.** The 5-minute cron bumps overdue UNASSIGNED cases one
priority rung (once, `escalatedAt`), notifies all active staff, and leaves
the deadline in place. Assigned-but-idle cases are the assignee's
responsibility - check the workload panel.

**Decision guidance by case type.**

| Case type                     | Guidance                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| MINOR_SAFETY                  | Treat as incident (see runbook). Never dismiss without a second person.                      |
| EXPLICIT_CONTENT              | Photo hidden already at HIGH+; confirm or approve-photo/dismiss (false positive).            |
| STOLEN_IMAGES / IMPERSONATION | Compare against verification results; require photo verification when unsure.                |
| SPAM / SCAM                   | Check trust signals and message patterns; LIMIT first unless the lexicon evidence is strong. |
| HARASSMENT                    | Read the linked reports; graduated actions, suspend on repeat.                               |
| PAYMENT_ABUSE                 | Cross-check `/admin/payments`; involve an ADMIN.                                             |

Every decision requires a written reason; enforcement reasons are
staff-only (`internalReason`) - the user always receives the calm
`userVisibleReason` copy instead.

**Appeals.** Start review -> optionally Ask for info (the question IS shown
to the user) -> Approve (reverses the violation) or Reject (final). Decide
with notes; notes stay staff-side.

## 7. Runbooks

**Provider outage (moderation).** Symptom: `needs_review` spike, provider
health card shows consecutive failures. The chain already fell through in
order; all-fail queues photos to humans (never auto-approve). Action: check
`/admin/trust-safety` provider card or `GET /api/admin/safety/providers`;
reorder/remove the sick provider in `MODERATION_PROVIDERS`; work the review
queue. Recovery is automatic when the provider returns (health resets on
first success).

**Email bounce storm.** Symptom: BOUNCED deliveries climbing. Hard bounces
and complaints auto-populate `SuppressedEmail` - the worker refuses those
addresses forever after. Action: verify sender domain/DNS in Resend, check
`RESEND_WEBHOOK_SECRET` is still valid, inspect recent `SuppressedEmail`
rows. Suppressions are only ever lifted manually (deliberate DB action).

**False positive.** Approve the user's appeal (preferred - it documents
itself), or on the case use "Reverse decision" / "Approve photo & dismiss".
Reversal restores everything atomically: violation marked reversed, photo
restored, account status recomputed from what remains, ban credentials
lifted when no live ban remains, case -> REVERSED.

**Banned user appeal.** Banned users keep Appeals Centre access
(restricted-tolerant session). The appeal arrives in `/admin/appeals` like
any other; approval lifts the ban AND removes the phone/device blocklist
rows. Rejection is final for that violation.

**Minor-safety incident.** Automation already blocks the photo, suspends
(policy-critical) and opens an urgent CRITICAL case. A human must: claim
the case immediately, verify, ban via the case actions if confirmed (adds
credentials to the blocklist), preserve evidence (case evidence JSON +
provider references), and follow the legal escalation policy for the
jurisdiction. Never dismiss solo; get a second reviewer.

## 8. Environment variables

| Var                                                                   | Purpose                                                                                                      |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `MODERATION_PROVIDERS`                                                | Ordered chain, e.g. `openai,google_vision,hive`. Unset = no external chain -> photos queue for human review. |
| `MODERATION_PROVIDER`                                                 | Legacy single-provider selector; `mock` in tests.                                                            |
| `OPENAI_API_KEY` / `GOOGLE_VISION_API_KEY` / `HIVE_API_KEY`           | Adapter keys.                                                                                                |
| `MODERATION_API_URL` / `MODERATION_API_KEY` / `MODERATION_TIMEOUT_MS` | Generic "external" adapter.                                                                                  |
| `MOCK_MODERATION_SCORES`                                              | Deterministic scores for tests.                                                                              |
| `RESEND_API_KEY` / `EMAIL_FROM`                                       | Email transport; unset = honest DEAD deliveries.                                                             |
| `RESEND_WEBHOOK_SECRET`                                               | Svix signing secret for `/api/webhooks/email`.                                                               |
| `IP_INTEL_PROVIDER` / `IP_INTEL_API_KEY`                              | VPN/TOR intel (ipqs / ipinfo). Unset = signal absent.                                                        |
| `DISPOSABLE_EMAIL_DOMAINS`                                            | Extra comma-separated disposable domains.                                                                    |
| `APPEAL_ATTACHMENTS_ENABLED`                                          | Designed-not-enabled flag; API 501s until "true".                                                            |
| `CRON_SECRET`                                                         | Bearer token for cron routes (fail closed).                                                                  |
| `VERIFICATION_WEBHOOK_SECRET` / `STRIPE_WEBHOOK_SECRET`               | Signed webhook verification.                                                                                 |
| `AUTH_HASH_SALT`                                                      | Salt for device/IP hashes (privacy stance in device.ts).                                                     |

## 9. Recovery procedures

- **Webhook replay** is safe: email + verification webhooks verify
  signatures with timestamp tolerance and process idempotently (state
  advances by provider message id / verification id; duplicates no-op).
- **Cron re-run** is safe: outbox claims rows atomically
  (PENDING+nextAttemptAt CAS), escalation bumps once per case
  (`escalatedAt` CAS), appeal expiry claims per row - two overlapping runs
  cannot double-send or double-bump.
- **Provider health** self-heals: counters reset on the first success.
- **Suppression list** is intentionally sticky - removing an address is a
  deliberate manual `SuppressedEmail` delete after root-causing the bounce.

Related: docs/ADMIN-SETUP.md (roles + bootstrap), docs/NOTIFICATIONS-NATIVE.md
(outbox internals), PRODUCTION_CHECKLIST.md.
