# Face Verification — Emergency Rollback Guide

How to stop or reverse the face-verification layer, fastest-first. This
**reverses** progress on the status board (FACE-VERIFICATION-RUNBOOK.md); it
never deletes user identity. Identity verification (Stripe / `photoVerifiedAt`)
is a SEPARATE layer and is untouched by every step here.

## Decision tree

- **Bad decisions / vendor incident, want an instant stop:** Tier 1
  (`FACE_EMERGENCY_DISABLE=1`).
- **Want the layer fully dormant (badge = identity only):** Tier 2 (unset
  `FACE_MATCH_PROVIDER`).
- **Suspicion of a data/biometric issue at the vendor:** Tier 2 + Tier 3
  (vendor purge).
- **Only a subset over-suspended:** don't roll back — clear suspensions (SQL
  below) and/or lower `FACE_VERIFICATION_PERCENT`.

## Tier 1 — Kill switch (seconds, keeps config)

```
FACE_EMERGENCY_DISABLE=1
```

Checked by one canonical helper (`faceEmergencyDisabled`) at admission AND at
every processing/enrollment path: `admitToFaceVerification` (no new work),
`runProfilePhotoVerification` (no comparison/grant), `sweepQueuedFaceChecks`
(processes nothing), and `consumeLivenessFlow` (no `IndexFaces` enrollment).
So flipping it to `1` halts new admission, in-flight processing, and
enrollment - not merely admission. It also raises the
`emergency_disable_active` alert (FACE-ALERTING.md) so the stop is visible.
Use when you need to stop NOW and keep the provider configured for a quick
resume. Reverse by removing the var.

> Note: existing badges stay as they are (Tier 1 stops *admission*, it does
> not clear state). To also hide already-granted badges, suspend them
> (admin action) or proceed to Tier 2.

## Tier 2 — Dormancy (unset the provider)

```
FACE_MATCH_PROVIDER=   # unset / empty
```

The provider resolves to "not configured": the badge derives from identity
alone, no biometric processing occurs. This is the durable "off". Optionally
clear residual suspensions so no user is left visibly suspended by a layer
that is now off:

```sql
-- clear face-badge suspensions (identity badge is unaffected)
UPDATE "User" SET "faceBadgeSuspendedAt" = NULL WHERE "faceBadgeSuspendedAt" IS NOT NULL;
```

## Tier 3 — Vendor-side purge (biometric data removal)

Use the ops CLI with the **admin** credential (the runtime credential cannot
administer collections — see AWS-IAM-VERIFICATION.md):

- Per-user: `deleteAllUserReferences(userId, reason)` (idempotent; the same
  path consent-withdrawal uses — FACE-CONSENT-WITHDRAWAL.md).
- Whole collection: `purgeAllReferences()` / DeleteCollection (admin cred
  only). References are re-creatable from a fresh liveness capture, so nothing
  is permanently lost by purging.

Reference-deletion failures raise `reference_deletion_failure` and dead-letter
for retry — confirm the DLQ drains to zero after a purge.

## Tier 4 — Code revert

All face changes are additive. Migrations `20260715060000` + `20260716060000`
leave inert tables/columns; reverting the code leaves them dormant and safe.
Appeals the layer created remain valid history (violations reverse, never
delete) — no cleanup required.

## Roll BACK the rollout percentage (partial)

To shrink exposure without going dormant, lower `FACE_VERIFICATION_PERCENT`
(state 6). Setting it to 0 returns to allowlist-only (rehearsal posture)
without unconfiguring the provider.

## Verification after any rollback

1. `emergency_disable_active` fired (Tier 1) or the provider reads as
   not-configured (Tier 2) — check the admin status views.
2. No new `face_check_run` audit events after the change.
3. DLQ count returns to 0 after a purge (FACE-ALERTING.md).
4. Identity badges for verified users are still present (`photoVerifiedAt`
   untouched) — the rollback must not have touched identity.

## What rollback must NOT do

- Must not delete or clear `photoVerifiedAt` (that is identity, not this
  layer).
- Must not set or imply legal approval — a rollback is orthogonal to state 3.
- Must not crash user flows — every path here fails safe (dormant), never
  open.
