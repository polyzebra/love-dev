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
