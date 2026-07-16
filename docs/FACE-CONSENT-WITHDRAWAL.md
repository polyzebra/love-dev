# Face Verification — Consent Withdrawal Runbook

How biometric consent withdrawal works end to end, and how to operate it. A
user may withdraw consent to face processing at any time; identity
verification (Stripe / `photoVerifiedAt`) is SEPARATE and is never affected.

This is orthogonal to the lifecycle states — withdrawal must work in every
state, including a live rollout. It is also rehearsal steps 11–12
(FACE-REHEARSAL.md).

## What withdrawal does (authoritative)

`withdrawFaceConsent(userId)` (`src/lib/services/face-verification.ts`),
exposed at `POST /api/verification/consent/withdraw` (authenticated; the
caller can only withdraw their OWN consent — no arbitrary `userId`):

1. Clears `consentAt` / `consentVersion` on the verification job.
2. Drops the reference pointer and idles the job to `LIVENESS_REQUIRED`
   (re-consent must re-enroll from a fresh liveness capture).
3. Sets `faceBadgeSuspendedAt` → the verified **badge is hidden**.
4. Leaves `photoVerifiedAt` **intact** → identity verification is unchanged.
5. Deletes every AWS reference via `deleteAllUserReferences(userId,
   "consent_withdrawal")` — idempotent; vendor-outage failures dead-letter
   and retry rather than crash the withdrawal.

Owner-facing copy after withdrawal:

> Photo comparison is turned off. Your verified badge is hidden. You can
> enable it again by giving consent and completing profile verification.

## Guarantees

- **Idempotent.** Re-running withdrawal (or deletion) is safe and reports
  zero failures once drained.
- **No raw biometric exposed.** Deletion works on internal reference records;
  no FaceId / sessionId is surfaced to the user or logs.
- **Account deletion uses the same cleanup.** `deleteFaceVerificationData`
  wraps the same reference deletion, so account teardown removes biometric
  data identically.
- **Consent guard on the run path.** If consent is withdrawn while a job is
  pending/claimed, the run no-ops (idles to `LIVENESS_REQUIRED`) — nothing is
  processed or granted without CURRENT consent.

## Re-consent

The user gives consent again and completes a fresh liveness capture; a new
reference is enrolled and the badge can be re-granted through the normal
pipeline. Prior references are not resurrected — a new capture is required.

## Operating / verifying a withdrawal

1. Confirm `consentAt` is null and the badge is hidden
   (`isPubliclyVerified` false) while `photoVerifiedAt` is unchanged.
2. Confirm no ACTIVE reference remains
   (`faceReferenceRecord` status not in PROVIDER_CREATED/LINKED).
3. If `reference_deletion_failure` fired (vendor outage), let the sweep
   drain the DLQ; re-run deletion is safe. Escalate only if it will not
   drain (FACE-ALERTING.md → FACE-EMERGENCY-ROLLBACK.md Tier 3).

## Data-subject request (DSR) handling

A GDPR erasure request for biometric data is satisfied by withdrawal +
reference deletion above (DPIA §9 deletion-verification,
DPIA-FACE-VERIFICATION.md). Record the request per the DSR workflow; the
biometric deletion itself is the same idempotent path.
