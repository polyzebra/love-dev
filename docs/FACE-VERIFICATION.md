# Profile-Photo Verification (Face Match Layer)

> **Status: NOT production-ready.** The trusted reference-source path is
> decided but not yet implemented - see
> [FACE-REFERENCE-AUDIT.md](FACE-REFERENCE-AUDIT.md) (verdict: separate
> Tirvea-owned video-selfie liveness via AWS Rekognition, eu-west-1;
> the Stripe selfie was REJECTED as a persistent reference source).
> `FACE_MATCH_PROVIDER` stays unset in production until that audit's
> implementation plan and DPIA/DPA items are complete.

## Architecture

Two SEPARATE verifications, deliberately never merged:

| Layer                          | Question answered                                         | Canonical state                                      | Provider                  |
| ------------------------------ | --------------------------------------------------------- | ---------------------------------------------------- | ------------------------- |
| 1. Identity (Stripe Identity)  | Real person + own document + live selfie matches document | `Verification` (type PHOTO) + `User.photoVerifiedAt` | `photo-verification.ts`   |
| 2. Profile photos (this layer) | Does the Tirvea gallery belong to that verified person?   | `ProfilePhotoVerification` + `PhotoFaceCheck` rows   | `face-match-providers.ts` |

**Public badge** = `isPubliclyVerified()` in `verification.ts`:
`photoVerifiedAt != null && faceBadgeSuspendedAt == null`. Layer 2 can
WITHHOLD the badge (suspension) but never un-verifies the identity.
`User.faceBadgeSuspendedAt` is the one denormalized column so hot read
paths (discovery/explore/chat) never join the face tables.

**Dormancy**: with `FACE_MATCH_PROVIDER` unset the entire layer is inert
(enqueue no-ops, cron sweeps 0, UI identical to the identity-only
system). This is also the rollback lever.

### Workflow

```
Stripe verified webhook (signature-checked, idempotent)
  -> enqueueProfilePhotoVerification()        [row write only - cheap]
  -> after(() => runProfilePhotoVerification) [post-response, never in-request]
     -> createReference (once, from the identity selfie)
     -> per ACTIVE photo VERSION without a stored verdict:
        compareReferenceToPhoto + assessManipulationRisk
        -> classifyComparison() -> PhotoFaceCheck row
     -> decideProfile() -> status/badgeStatus/riskLevel
     -> User.faceBadgeSuspendedAt maintained
     -> VerificationAuditEvent + notification
/api/cron/face-checks (*/10 min)              [recovery sweep for QUEUED]
```

Photo mutations (upload / delete-promotes-cover / reorder-crowns-cover)
call `onProfilePhotosChanged()` - same enqueue+after pattern. A verified
profile keeps its badge (`REVIEWING`) while a change is re-checked;
verdicts are pinned to `(photoId, mediaVersion)` so unchanged photos are
NEVER re-analysed and replaced bytes are ALWAYS re-analysed.

### Policy (env-tunable per provider - never one universal threshold)

Cover: exactly one dominant matching face -> pass; confident mismatch ->
fail CLOSED; anything uncertain -> manual review. Gallery: no-face
lifestyle photos allowed; groups with the owner allowed; unrelated-person
photos flagged; more than `FACE_MAX_OTHER_PERSON_PHOTOS` -> badge
suspended. Full table: `classifyComparison()` / `decideProfile()` in
`face-verification.ts` (both pure, both exhaustively tested).

### Front-end states

`deriveVerificationPresentation()` (pure, `verification-presentation.ts`)
combines the CANONICAL 7-state identity machine (unchanged) with the face
job: `not_started, requires_input, processing_identity,
checking_profile_photos, manual_review, verified, photo_update_review,
action_required, failed, expired`. Users never see provider vocabulary,
sub-states or similarity numbers.

### Admin

`/admin/verification` gains a "Profile photo checks" queue
(MANUAL_REVIEW / REJECTED / SUSPENDED, oldest first): per-photo
classification + confidence BAND + reason codes. Actions (all RBAC
`verifications:review`, all writing `VerificationAuditEvent`): Approve,
Reject photo (unpublishes via the EXISTING moderation gate), Request new
selfie (destroys the provider reference -> re-challenge), Suspend badge,
Restore badge, Escalate. Staff never see raw similarity values or
identity documents (documents stay at Stripe behind its own
restricted-access controls).

## Privacy & legal (DPIA input)

Face geometry is biometric data in several jurisdictions (GDPR art. 9,
Illinois BIPA, ...). This implementation's stance:

- **No biometric storage at Tirvea**: only the provider's OPAQUE
  `referenceId`, classifications, bands and policy scores. A test pins
  the schema against embedding/template/descriptor columns.
- **Consent**: versioned (`BIOMETRIC_CONSENT_VERSION`), stamped on the
  job row at identity approval; the consent dialog explicitly states the
  selfie is compared with profile photos. Re-consent is required when the
  version changes.
- **Deletion**: `teardownAccount` -> `deleteFaceVerificationData()` ->
  `provider.deleteReference()` (vendor-side destruction) + row cascade.
- **Retention**: `expiresAt` (default 365d via `FACE_REFERENCE_TTL_DAYS`)
  bounds the reference; re-challenge replaces it.
- **No raw values in logs/errors/URLs**: the service never logs; audit
  metadata carries counts and reason codes only.
- **Appeal path**: manual review queue + admin restore; user-facing
  action_required state explains the fix without exposing internals.

Before ENABLING in production (user-side checklist):

1. DPIA covering face comparison purpose/necessity/proportionality.
2. DPA with the face-match vendor; verify EU/IE/UK biometric processing
   permissions (Stripe DPA already covers layer 1).
3. Update the privacy policy + consent copy review by counsel.
4. Calibrate thresholds against a real sample set (see below) - the
   defaults are MOCK calibrations, not vendor truths.

## Deployment variables

| Var                            | Default      | Meaning                                                                                                                  |
| ------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `FACE_MATCH_PROVIDER`          | "" (dormant) | `mock` (dev/tests only, refused in production) / `aws_rekognition_faces` (documented stub - SigV4 + Collections pending) |
| `FACE_MATCH_THRESHOLD`         | 0.85         | similarity >= -> confident match                                                                                         |
| `FACE_MISMATCH_THRESHOLD`      | 0.40         | similarity <= -> confident mismatch                                                                                      |
| `FACE_MIN_QUALITY`             | 0.50         | below -> UNCERTAIN, never a verdict                                                                                      |
| `FACE_MANIPULATION_THRESHOLD`  | 0.80         | >= -> MANIPULATION_RISK                                                                                                  |
| `FACE_COVER_MIN_DOMINANCE`     | 0.20         | min face-area ratio for a valid cover                                                                                    |
| `FACE_MAX_OTHER_PERSON_PHOTOS` | 2            | gallery mismatches beyond this suspend the badge                                                                         |
| `FACE_REFERENCE_TTL_DAYS`      | 365          | reference re-challenge horizon                                                                                           |

Cron: `/api/cron/face-checks` every 10 min (vercel.json), bearer
`CRON_SECRET`, safe to keep scheduled while dormant.

## Rollback plan

1. **Feature off**: unset `FACE_MATCH_PROVIDER` -> layer dormant, badge
   = identity-only. Clear any suspensions if desired:
   `UPDATE "User" SET "faceBadgeSuspendedAt" = NULL;`
2. **Code revert**: the whole feature is additive - revert the commit;
   the three new tables/enums and the nullable `faceBadgeSuspendedAt`
   column are inert leftovers (drop later with a cleanup migration if
   wanted).
3. Migration `20260715060000_profile_photo_verification` is
   additive-only (no data rewrites) - no down-migration needed for
   safety; DDL was applied via the runtime client (`prisma migrate`
   CLI hangs against the transaction pooler - known project issue).

## Production verification checklist

- [ ] `FACE_MATCH_PROVIDER` set to a REAL vendor (not mock - production
      builds refuse it) with its creds
- [ ] Thresholds calibrated on a labelled sample (target: <1% false
      cover mismatch at the chosen match threshold)
- [ ] DPIA + vendor DPA signed (see Privacy above)
- [ ] Cron firing (Vercel dashboard) and `processed` > 0 after a test
      enqueue
- [ ] A staged user: verify identity -> watch checking_profile_photos ->
      AUTO_VERIFIED -> badge; replace cover with a non-matching photo ->
      photo_update_review -> action_required -> badge withheld publicly
- [ ] Admin queue renders classifications; every action writes a
      VerificationAuditEvent
- [ ] `npx tsx tests/face-verification.test.ts` green (28 checks)
