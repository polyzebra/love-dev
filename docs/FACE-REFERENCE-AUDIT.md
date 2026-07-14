# Face Reference Source Audit (2026-07)

Status: **DECISION DOCUMENT** - no provider calls were made, no
credentials added, `FACE_MATCH_PROVIDER` remains unset. The face layer
shipped in `ae90f90` is NOT production-ready until the reference path
below is implemented and proven; its `createReference()` seam is exactly
where the chosen path plugs in.

## 1. What the current code assumes vs what is true

`face-verification.ts` passes `{ userId, identitySessionId }` to
`provider.createReference()` and stores only the returned opaque
`referenceId`. The mock derives a reference from `userId`; the REAL
source of a trusted reference face was deliberately left open. This
audit closes that gap.

## 2. Stripe Identity capabilities (primary-source audit)

What Stripe DOES provide (docs.stripe.com/identity/access-verification-results):

- Selfie + document images are retrievable server-side: restricted API
  key (Identity reports read + Files write) -> VerificationReport
  `selfie.selfie` file id -> short-lived FileLink (docs use 30s expiry).
- Selfie check = selfie <-> document photo match + liveness heuristics,
  executed INSIDE the session. Result: verified / requires_input.

What Stripe does NOT provide (confirming the audit's suspicions):

- NO reusable biometric template or FaceVector - no API surface at all.
- NO ongoing face-comparison API (nothing to compare gallery photos
  against later).
- NO duplicate-likeness search.
- NOT unrestricted media: default restricted keys reach sensitive
  results only for verifications **processed in the last 48 hours**
  (longer access requires IP-restricted keys arranged with Stripe).
- NO permission posture for re-purposing: Stripe's documented handling
  guidance is explicit - _"access image content with short-lived
  FileLinks, don't make copies of the file contents"_ and _"redact
  sessions and collected images when you're done using them for the
  purpose collected."_ Creating a persistent biometric reference at a
  second vendor from the Stripe selfie means copying the media,
  extending the purpose, and transferring special-category data to
  another processor - the opposite of that guidance, and a fresh
  GDPR art. 6+9 basis would be required on top of contractual review.

## 3. Decision matrix

| Criterion                | A. Stripe selfie as reference                                                                                            | B. Tirvea video-selfie liveness check                                                                      | C. Still-selfie capture              | D. Cover photo as reference                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------- |
| Liveness strength        | High at capture (Stripe) but NOT re-attested for the new purpose                                                         | **High** - dedicated liveness (e.g. Rekognition Face Liveness) at reference-creation time                  | None (photo of a photo passes)       | None                                                    |
| Impersonation resistance | Medium-high                                                                                                              | **High**                                                                                                   | Low                                  | **None - the thing being verified would verify itself** |
| Provider support         | Fragile: 48h access window, copy prohibition, IP-key exception requires Stripe support                                   | **Native** - liveness products return a reference frame designed for enrolment                             | Universal but weak                   | Universal but meaningless                               |
| Consent                  | New explicit consent for re-purposing STRIPE-collected media + biometric processing                                      | Explicit biometric consent at OUR capture - clean, single-purpose                                          | Explicit consent                     | Consent exists but verifies nothing                     |
| EU/IE/UK legal           | Weakest: purpose-limitation (art. 5(1)(b)) problem, processor-to-processor transfer, German ID-image law cited by Stripe | **Cleanest**: data minimised, collected by Tirvea for exactly this purpose, EU-region processing available | Acceptable legally, weak technically | Rejected before legal analysis                          |
| Retention                | Bound to Stripe redaction guidance - conflict                                                                            | Our policy: reference at vendor, TTL + re-challenge (already modelled: `expiresAt`)                        | Same                                 | n/a                                                     |
| Deletion                 | Two processors to purge                                                                                                  | `DeleteFaces`/reference deletion at ONE vendor (seam exists: `deleteReference`)                            | Same                                 | n/a                                                     |
| User friction            | **Zero extra** (one flow)                                                                                                | One extra ~5s selfie video after Stripe - moderate                                                         | One extra photo - low                | Zero                                                    |
| Cost                     | $0 marginal                                                                                                              | ~$0.015/liveness + ~$0.001/compare                                                                         | ~$0.001/compare                      | $0                                                      |
| Failure handling         | If reference creation fails >48h after verification, NO recovery without a new $1.50 Stripe session                      | Re-run liveness any time for ~$0.015 - independent of Stripe                                               | Recapture any time                   | n/a                                                     |

**Rejected:** D outright (spec rule 4: an unverified profile photo can
never seed the trust chain - it would let an impersonator verify their
own stolen photos). C rejected as primary (no liveness = the central
attack, submitting a photo of the victim, succeeds). A rejected as the
persistent reference source: technically possible inside 48h but
contractually/legally fragile, unrecoverable after the window, and it
couples re-challenges to paid Stripe sessions.

**Selected: B** - a separate, Tirvea-owned, consented video-selfie
liveness capture that produces the trusted reference.

Optional hardening (phase 2, not required for launch): inside the 48h
window, a one-time server-side _comparison_ (never a copy) of the new
liveness reference against the Stripe selfie via a short-lived FileLink
adds a cross-provider binding ("the person who did our liveness check is
the person Stripe verified") without persisting Stripe media. Requires
counsel sign-off on the FileLink fetch being within "the purpose
collected"; skip if not.

## 4. Recommended provider architecture

**Two providers, clean separation (question 6 answered):**

- **Stripe Identity** (unchanged): document authenticity, selfie-to-document
  match and liveness at identity time. It cannot do ongoing comparison;
  nothing else can replace its document verification.
- **AWS Rekognition** (`aws_rekognition_faces`, the stub already named in
  `face-match-providers.ts`): everything the face layer needs -
  - **Video liveness**: Rekognition Face Liveness - available in
    **Europe (Ireland, eu-west-1)** - the same region as Tirvea's data
    stack; ~$0.015/check. Returns a high-quality _reference frame_ +
    audit frames to OUR S3 bucket.
  - **Opaque reusable reference**: `IndexFaces(reference frame)` into a
    per-environment **Collection** -> `FaceId` = our `referenceId`
    (opaque handle; the vector lives at AWS, never at Tirvea - the
    existing privacy pin holds).
  - **Comparison**: `SearchFacesByImage(collection, photoBytes)` per
    gallery photo; owner match = top hit FaceId == referenceId with
    similarity/quality read from the response. (CompareFaces would need
    reference bytes we deliberately do not keep.)
  - **Duplicate-account likeness search** (optional): `SearchFaces`
    (FaceId vs FaceId) across the same collection - flag matches to the
    fraud queue, never auto-action.
  - **Deletion**: `DeleteFaces(referenceId)` + S3 lifecycle purge of
    liveness frames (<= 24h) -> the existing `deleteReference()` seam.
  - **EU-region processing**: pin every call + the collection + the S3
    bucket to eu-west-1.

Front-end note: Face Liveness capture uses AWS Amplify's
`FaceLivenessDetector` (React) against backend-created liveness
sessions - a new client dependency to budget (bundle-gate it behind a
dynamic import on the verification card only).

Alternatives considered: FaceTec / iProov (stronger certified liveness,
EU processing, but new vendor DPA + enterprise pricing + SDK weight);
Onfido/Veriff (full IDV suites - redundant with Stripe). Rekognition
wins on region, cost, incremental DPA surface (one hyperscaler), and
the already-designed adapter slot.

## 5. Exact data flow

```
1. capture           User taps "Verify photos" AFTER identity approval ->
                     explicit versioned biometric consent (BIOMETRIC_CONSENT_VERSION)
                     -> FaceLivenessDetector session (eu-west-1)
2. liveness          CreateFaceLivenessSession / GetFaceLivenessSessionResults
                     confidence < threshold -> retry (max N) -> manual_review
3. reference         reference frame -> IndexFaces(collection) -> FaceId
                     stored as ProfilePhotoVerification.referenceId
                     (provider="aws_rekognition_faces", referenceVersion++,
                     expiresAt = now + FACE_REFERENCE_TTL_DAYS)
                     -> liveness frames deleted from S3 (lifecycle <= 24h)
4. comparison        runProfilePhotoVerification(): per ACTIVE (photoId,
                     mediaVersion) -> SearchFacesByImage -> classifyComparison()
5. provider result   similarity/quality/faceCount -> PhotoFaceCheck rows
                     (bands + reason codes; raw scores internal-only)
6. internal decision decideProfile() -> AUTO_VERIFIED / MANUAL_REVIEW /
                     REJECTED / SUSPENDED -> badgeStatus ->
                     User.faceBadgeSuspendedAt -> VerificationAuditEvent
7. retention         referenceId valid until expiresAt; photo changes reuse
                     it (no new capture); expiry/fraud -> re-challenge (step 1)
8. deletion          account teardown / admin request_new_selfie ->
                     DeleteFaces + row cascade + audit event
```

## 6. Expected costs (Rekognition, eu-west-1 list prices)

| Event                                            | Ops                                            | Cost             |
| ------------------------------------------------ | ---------------------------------------------- | ---------------- |
| First verification (liveness + index + 6 photos) | 1 liveness, 1 IndexFaces, 6 SearchFacesByImage | ~**$0.022/user** |
| Photo change                                     | 1-2 SearchFacesByImage                         | ~$0.002          |
| Re-challenge                                     | liveness + IndexFaces                          | ~$0.016          |
| Duplicate search                                 | 1 SearchFaces                                  | ~$0.001          |

Contrast: Stripe Identity itself is ~$1.50/verification - the face layer
adds ~1.5% on top. At 10k verifications/month: ~$220.

## 7. DPA / DPIA requirements

- **AWS DPA** (GDPR-standard, self-serve) covering Rekognition biometric
  processing; confirm Face Liveness biometric terms for EU/IE/UK use;
  region-pin eu-west-1 (no cross-region replication).
- **Stripe DPA** already in force for layer 1; NO new Stripe scope needed
  under option B (we stop at their boundary).
- **DPIA** (mandatory - art. 35: large-scale special-category data):
  purpose = impersonation/catfish prevention; necessity = document
  verification alone cannot bind gallery photos; proportionality =
  opaque vendor-side references, bands not raw scores, TTL, deletion,
  human review of every adverse outcome; lead authority = Irish DPC.
- **Consent**: explicit, versioned, separate from ToS; re-consent on
  version bump (already modelled: consentVersion/consentAt).
- Privacy policy + in-product copy review by counsel BEFORE enabling.

## 8. Implementation plan

1. **AWS foundation** (no code): account, eu-west-1 collection per env,
   S3 liveness bucket + 24h lifecycle, IAM user scoped to
   `rekognition:{CreateFaceLivenessSession,GetFaceLivenessSessionResults,IndexFaces,SearchFacesByImage,SearchFaces,DeleteFaces}` +
   the liveness S3 prefix. Envs: `AWS_REKOGNITION_REGION`,
   `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
   `FACE_COLLECTION_ID`, `FACE_LIVENESS_BUCKET`.
2. **Adapter**: implement `aws_rekognition_faces` behind the EXISTING
   `FaceComparisonProvider` interface (SigV4 signing; house fetch-based
   pattern, injectable transport like the Stripe adapter). Two new
   methods on the interface: `createLivenessSession()` /
   `getLivenessResult()` (additive, mock implements trivially).
3. **Capture UI**: liveness step on the verification card after
   identity approval (`checking_profile_photos` gains a
   "capture needed" sub-state); dynamic-import the Amplify detector;
   consent dialog upgraded to the biometric copy (counsel-reviewed).
4. **Calibration**: labelled sample (>=200 pairs incl. twins/siblings/
   filters/AI images) -> set FACE_MATCH_THRESHOLD / MISMATCH / QUALITY
   for Rekognition's score distribution; document the numbers in
   FACE-VERIFICATION.md.
5. **Tests**: adapter transport tests (signed request shape), liveness
   state machine, threshold table against recorded vendor responses;
   the existing 28-check suite keeps covering policy/lifecycle.
6. **Duplicate-likeness search** (optional, after launch): SearchFaces
   on reference creation -> fraud-review queue entry; DPIA addendum.

## 9. Rollout and rollback

Rollout: staging with test collection -> internal accounts (staff run
real liveness) -> `FACE_MATCH_PROVIDER=aws_rekognition_faces` in
production once DPIA + DPA + calibration sign-offs land -> monitor
manual-review rate (>5% = thresholds wrong - pause and recalibrate).

Rollback (any point, in order of severity):

1. Unset `FACE_MATCH_PROVIDER` -> layer dormant instantly; badge =
   identity-only; optionally `UPDATE "User" SET "faceBadgeSuspendedAt" = NULL`.
2. `DeleteCollection` + empty the liveness bucket -> all vendor-side
   biometrics destroyed (references are re-creatable via re-challenge).
3. Code revert - everything remains additive.

## 10. Verdict

- Reference source: **B - Tirvea-owned video-selfie liveness (Rekognition
  Face Liveness, eu-west-1)**. A/C/D rejected (§3).
- Providers: **two** - Stripe (identity) + AWS Rekognition (liveness,
  reference, comparison, duplicate search, deletion). One provider
  cannot safely do both jobs.
- The shipped face layer stays **dormant and not production-ready**
  until §8 steps 1-5 plus the DPIA/DPA items in §7 are complete.
