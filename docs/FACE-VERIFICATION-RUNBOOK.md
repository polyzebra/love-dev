# Face Verification Runbook

Operations guide for the profile-photo verification layer. Companions:
FACE-VERIFICATION.md (architecture), FACE-REFERENCE-AUDIT.md (reference
source decision), THREAT-MODEL-VERIFICATION.md (threats + risk model).

## Sequence: happy path

```
User            Tirvea API              Stripe          FaceProvider      DB
 |--verify------>|                        |                  |            |
 |               |--create session------->|                  |            |
 |<--hosted url--|                        |                  |            |
 |--hosted flow------------------------->|                  |            |
 |               |<--verified webhook----|                  |            |
 |               |--verify sig, apply idempotently----------------------->| photoVerifiedAt
 |               |--enqueue face job------------------------------------->| QUEUED/REVIEWING
 |               |==after() run==========================================>|
 |               |--createReference (liveness-bound)->|                  |
 |               |<--opaque referenceId---------------|                  |
 |               |                                     |                 | ACTIVE + model + region
 |               |--compare each (photoId, mediaVersion)->|              | PhotoFaceCheck rows
 |               |--decideProfile + risk gate---------------------------->| AUTO_VERIFIED + badge
 |               |--duplicate likeness search->|                         | duplicateClass
 |<--badge live--|                                                       | audit events
```

## Sequence: appeal

```
REJECTED/SUSPENDED --> AccountViolation (PHOTO_MISMATCH | IMPERSONATION)
      |                                   [face_violation_created audit]
      v
User submits appeal (existing /settings flow) -> AppealEvent "submitted"
      v
Staff review (existing /admin/appeals)  -> optional NEEDS_INFO round-trips
      v
approve -> reverseViolation -> onFaceViolationReversed:
           badge restored + fresh re-check enqueued
           [face_appeal_reversed audit]
reject  -> appeal REJECTED (feeds the risk engine as appeal_denied)
Every transition = immutable AppealEvent; history is never rewritten.
```

## Reference lifecycle

```
(none) --enrol--> ACTIVE --renewal window--> EXPIRING --expiresAt--> rotate
ACTIVE/EXPIRING --rotate(reason)--> ROTATING --re-enrol--> ACTIVE (v+1)
any --fraud/policy--> REVOKED   any --teardown/user--> DELETED
Usable states: ACTIVE, EXPIRING. EXPIRED/REVOKED/DELETED are NEVER
reused (enforced before every run; tested).
Rotation reasons: provider_upgrade | reference_expiry | manual_review |
fraud_investigation | user_request | policy_change.
Rotation NEVER requires a new Stripe session - identity re-verification
is a separate explicit staff decision.
```

## Configuration reference

| Env                                                                                                                                                                                               | Default                  | Meaning                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------- |
| `FACE_MATCH_PROVIDER`                                                                                                                                                                             | ""                       | layer master switch          |
| `FACE_MATCH_THRESHOLD` / `FACE_MISMATCH_THRESHOLD` / `FACE_MIN_QUALITY` / `FACE_MANIPULATION_THRESHOLD` / `FACE_COVER_MIN_DOMINANCE` / `FACE_MAX_OTHER_PERSON_PHOTOS` / `FACE_REFERENCE_TTL_DAYS` | see FACE-VERIFICATION.md | per-photo + aggregate policy |
| `FACE_REFERENCE_RENEWAL_WINDOW_DAYS`                                                                                                                                                              | 30                       | ACTIVE -> EXPIRING horizon   |
| `RISK_MEDIUM_AT` / `RISK_HIGH_AT` / `RISK_CRITICAL_AT`                                                                                                                                            | 25 / 50 / 75             | band boundaries              |
| `RISK_W_*` (identity_unverified, face_rejected, face_suspended, manipulation, other_person(+cap), dup_impersonation, dup_unresolved, reference_invalid, appeal_denied(+cap))                      | see risk-engine.ts       | face-signal weights          |

## Runbook: routine operations

- **Queue stuck (jobs in QUEUED > 30 min)**: check `/api/cron/face-checks`
  fired (Vercel cron logs); invoke manually with the CRON_SECRET bearer;
  each response reports `{processed, lifecycle}`.
- **Manual-review backlog**: /admin/verification "Profile photo checks";
  each card shows risk band + threat flags + duplicate class + appeals.
  Approve / Reject photo / New selfie / Suspend / Restore / Escalate.
- **False-positive spike** (manual-review rate > 5% of runs): thresholds
  drifted - recalibrate FACE_* envs against a labelled sample; the audit
  trail (`risk_gate_hold`, `face_check_run` events) shows which gate fires.
- **Provider model upgrade**: bump the adapter's `modelVersion`; the
  lifecycle sweep rotates old references automatically (reason
  `provider_upgrade`), a few per cron tick (rate-limited by `take`).
- **User asks for data deletion**: account deletion already destroys the
  vendor reference; for verification-only deletion run
  `rotateReference(userId, "user_request")` then set referenceStatus
  DELETED if they also decline re-enrolment.

## Incident response

| Incident                                            | First moves                                                                                                | Containment                                                                                      | Recovery                                                                                                                            |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Face provider outage                                | Runs fail SAFE automatically (jobs park in QUEUED, badges keep last state, nothing granted)                | none needed - queue absorbs                                                                      | cron sweeps drain the queue when the vendor returns                                                                                 |
| Suspected wrongful suspensions (bad threshold push) | `UPDATE "User" SET "faceBadgeSuspendedAt" = NULL WHERE ...` for the affected cohort; revert the env change | pause the layer: unset `FACE_MATCH_PROVIDER`                                                     | re-run affected users (enqueue + sweep); audit events identify the cohort (`face_check_run` with `reasonCode=policy` in the window) |
| Impersonation wave (many LIKELY_IMPERSONATION)      | confirm via admin queue + risk flags; escalate to fraud review                                             | suspensions are already automatic ONLY for impersonation; consider `RISK_CRITICAL_AT` tightening | victims keep badges (first-verified wins); attackers appeal through the normal channel                                              |
| Vendor data-breach notice                           | rotate ALL references: `rotateReference(*, "policy_change")` batch + `DeleteCollection` at the vendor      | unset provider while assessing                                                                   | fresh enrolments after the all-clear; DPIA incident annex                                                                           |
| Badge granted to a mismatch (false negative)        | staff Suspend badge + Escalate on the case; pull the PhotoFaceCheck rows (bands/reasons)                   | threshold review                                                                                 | recalibrate; the per-version pinning means only re-checks are affected                                                              |

## Incident runbooks (Phase 13)

Each: Detection -> Impact -> Immediate response -> Recovery -> Postmortem.

**AWS (face provider) outage**

- Detect: `provider_down` ops alert (breaker OPEN); metrics `providers.face_match:*` = UNAVAILABLE.
- Impact: new/changed photos park in QUEUED; badges keep last state; NOTHING auto-rejected.
- Respond: nothing destructive needed - confirm the breaker is open (no vendor traffic), watch queue depth.
- Recover: breaker half-opens after the cool-down; cron drains QUEUED; dead-letter sweep escalates anything that kept failing to manual review.
- Postmortem: `face_check_error`/`face_dead_letter` audit counts in the window; add a ProviderHealth graph snapshot.

**Stripe Identity outage**

- Detect: `provider_down` alert for stripe_identity; users report "Couldn't start verification"; ProviderHealth lastError HTTP 5xx.
- Impact: new identity verifications fail to start (start endpoint 500s); existing badges unaffected; open sessions resume when Stripe returns.
- Respond: confirm status.stripe.com; nothing to disable - the flow fails closed per attempt.
- Recover: sessions reuse on retry (no duplicates); reconciler completes webhook-lost sessions.
- Postmortem: correlate ProviderHealth error codes with Stripe's incident.

**Provider credential leak**

- Detect: unexpected vendor usage/billing, credential failure spikes after rotation, or disclosure report.
- Impact: potential unauthorized vendor API use; NO biometric exfiltration path through Tirvea (references are vendor-side, opaque).
- Respond: rotate the key at the vendor immediately; update the env in Vercel; redeploy. For AWS also invalidate the IAM key pair.
- Recover: verify healthy calls resume; rotate ALL face references if key had reference-read scope (`rotateReference(*, "policy_change")`).
- Postmortem: audit vendor-side access logs for the exposure window; review least-privilege scoping.

**Queue backlog**

- Detect: `queue_stalled` alert (oldest QUEUED beyond threshold); metrics queueDepth climbing.
- Impact: badge grants delayed; nothing incorrect happens.
- Respond: check cron execution (Vercel), provider health, and dead-letter counts - the three causes in practice.
- Recover: manual cron invocation drains 10/tick; raise the sweep `take` temporarily if needed.
- Postmortem: queue-depth timeline vs provider health.

**Dead-letter recovery**

- Detect: `rotation_or_run_failures` alert; `face_dead_letter` audit events.
- Impact: affected users sit in manual review instead of auto-verification.
- Respond: admin queue shows them with risk context - decide manually, or fix the root cause and re-enqueue (any photo change or admin approve re-enters the flow).
- Recover: after the provider recovers, re-enqueue the cohort (enqueue is idempotent).
- Postmortem: which failure class dominated (`ProviderHealth.lastError` prefixes).

**Manual review overload**

- Detect: manualReviewRate > 5% or queue page unwieldy.
- Impact: reviewer latency; users wait in REVIEWING (badge preserved for photo updates).
- Respond: check for a threshold regression or a fraud wave (risk flags distinguish them).
- Recover: recalibrate thresholds (false-positive path) or staff up (fraud path).
- Postmortem: FP% metric before/after.

**False positive incident** (legitimate users rejected/suspended)

- Detect: `false_positive_spike` alert (appeal-overturn rate), support tickets.
- Impact: wrongly withheld badges; trust damage.
- Respond: pause the layer if severe (unset FACE_MATCH_PROVIDER); triage the cohort via `face_check_run` audits in the window.
- Recover: batch-restore (`UPDATE "User" SET "faceBadgeSuspendedAt" = NULL WHERE ...` for the cohort), re-run after recalibration; approve pending appeals.
- Postmortem: which policy gate fired (reason codes), threshold delta, sample review.

**False negative incident** (mismatch got a badge)

- Detect: reports/impersonation complaints on a verified profile; duplicate-detection hit post-grant.
- Impact: trust harm - highest-severity class.
- Respond: staff Suspend badge + Escalate immediately; pull the check rows (bands/reasons).
- Recover: request_new_selfie re-challenge; tighten thresholds if systemic.
- Postmortem: FN% metric; adversarial sample added to the calibration set.

**Rollback / restore / emergency disable**

- Emergency disable: unset `FACE_MATCH_PROVIDER` (Vercel env + redeploy) - the layer is dormant instantly; badge = identity-only.
- Rollback: revert the commits - everything is additive; migrations leave inert tables.
- Restore: re-set the env; QUEUED work resumes; rotations re-enrol references lazily.

## Business continuity / disaster recovery (Phase 17)

| Scenario                           | Plan                                                                                                                                                                                                                                                                                        | RTO / RPO                                                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loss of AWS region (face provider) | Breaker opens; layer degrades to manual review + parked queue. Standing up a second region = new Collection + reference re-enrolment (references are NOT replicated by design - biometric minimisation).                                                                                    | RTO: badge pipeline 0 (degrades, never blocks the app); full auto-verification restored on region recovery or ~1 day for region migration. RPO: 0 (no data loss - references re-derivable). |
| Loss of Stripe                     | New identity verifications pause (fail closed per attempt); existing badges unaffected. No same-day substitute by design (vendor migration below).                                                                                                                                          | RTO: dependent on Stripe; product remains usable throughout. RPO: 0.                                                                                                                        |
| Database restore                   | Supabase PITR restores User/Verification/ProfilePhotoVerification consistently (all state is in ONE database - no cross-store drift). Provider-side references may then be ORPHANED: run a reconciliation rotation (`policy_change`) for rows whose referenceId predates the restore point. | RTO: Supabase PITR SLA. RPO: Supabase PITR granularity (minutes).                                                                                                                           |
| Queue restore                      | The queue IS database rows - restored with the database. Cron self-heals: QUEUED rows are re-swept; idempotent version-pinned checks make replays safe.                                                                                                                                     | Same as database.                                                                                                                                                                           |
| Cron failure                       | after() covers the primary path; cron is recovery-only. Detection: queue_stalled alert. Manual invocation with CRON_SECRET is the workaround.                                                                                                                                               | RTO: minutes (manual trigger).                                                                                                                                                              |
| Vendor migration                   | The FaceComparisonProvider seam is the contract: implement the new adapter, set modelVersion, flip FACE_MATCH_PROVIDER - the lifecycle sweep auto-rotates every reference to the new vendor (reason provider_upgrade), a few per tick. Zero user action, gradual, reversible.               | Full fleet rotation at sweep pace (configurable); no downtime.                                                                                                                              |
| Maximum tolerated downtime         | Verification is NOT on the critical product path: browsing/matching/chat run without it. MTD for verification itself: 72h (badge staleness acceptable); MTD for wrongful-suspension states: 4h (reputational).                                                                              | -                                                                                                                                                                                           |

## Production readiness checklist

- [ ] Real provider adapter implemented + calibrated (FACE-REFERENCE-AUDIT §8)
- [ ] DPIA signed off; AWS DPA + biometric terms confirmed (EU/IE/UK)
- [ ] Consent copy counsel-reviewed; BIOMETRIC_CONSENT_VERSION bumped
- [ ] Thresholds calibrated (<1% false cover mismatch on labelled sample)
- [ ] Risk-engine weights reviewed against real fraud base rates
- [ ] Cron firing in production; `lifecycle` counters visible
- [ ] Admin staff trained on the queue actions + appeal flow
- [ ] Staged rollout cohort verified end-to-end (identity -> liveness ->
      badge -> photo change -> re-check -> appeal round-trip)
- [ ] Test suites green: face-verification (28), face-security (18)

## Rollback plan

1. `FACE_MATCH_PROVIDER` unset -> instant dormancy (badge = identity-only).
   Optionally clear suspensions (SQL above).
2. Vendor-side purge: DeleteCollection / batch deleteReference - references
   are re-creatable, nothing is lost permanently.
3. Code revert: all changes additive; migrations
   `20260715060000` + `20260716060000` leave inert tables/columns.
4. Appeals created by the layer remain valid history (violations reverse,
   never delete) - no cleanup required.
