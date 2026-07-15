# M-2: Authorized Staging Integration Plan (real AWS)

Status: **PLAN — not executed.** The remediation is proven at the unit +
provider-contract layers (fake transport). The real AWS Face Liveness
media flow (does `GetFaceLivenessSessionResults` return a usable
`ReferenceImage` under our session config?) can only be verified against
AWS with a browser capture — which requires the AWS Amplify
`FaceLivenessDetector` SDK, a staging collection, and a test account.
This plan is the executable checklist. Do NOT use production users or the
production collection. Do NOT enable `FACE_MATCH_PROVIDER` in production.

## Preconditions

- Separate staging AWS collection: `FACE_COLLECTION_ID=tirvea-staging-faces`
  (created with the admin credential; never the production collection).
- Staging env: `FACE_ENVIRONMENT=staging`, `AWS_REGION=eu-west-1`,
  `AWS_REKOGNITION_REGION=eu-west-1`, `AWS_ALLOWED_REGIONS=eu-west-1`,
  `FACE_MATCH_PROVIDER=aws_rekognition_faces`, `FACE_LIVENESS_ENABLED=1`,
  `FACE_LEGAL_APPROVAL_VERSION=staging-only`.
- A dedicated test account (not a real member).
- The Amplify `FaceLivenessDetector` component wired into
  `LivenessCapture` (behind the existing dynamic import) — this is the one
  remaining build step; the endpoints + state machine already exist.

## Session-config verification (the M-2 core question)

1. `CreateFaceLivenessSession` — confirm it succeeds and returns a
   SessionId. Our adapter sends `Settings: { AuditImagesLimit: 0 }`.
2. Complete the browser capture with `FaceLivenessDetector`.
3. `GetFaceLivenessSessionResults` — confirm:
   - `Status: SUCCEEDED`;
   - **a `ReferenceImage.Bytes` is present** (the adapter needs it to
     `IndexFaces`). If it is NOT returned under `AuditImagesLimit: 0`,
     update the session config (enable an `OutputConfig` S3 bucket +
     `AuditImagesLimit`), fetch the reference frame from S3, and **update
     the privacy notice** to describe that audit-image handling before
     proceeding. Do not assume the current config yields a ReferenceImage.
4. `IndexFaces` accepts that exact image and returns a FaceId.
5. Confirm no raw video is retained by Tirvea (only the opaque FaceId in
   the registry); confirm audit-image behavior matches the notice.
6. Session expiry + retry behave (expired session denied; retry mints a
   new bound session, not a duplicate reference for the same version).

## End-to-end staging matrix (each recorded as normalized evidence only)

| Scenario              | Expected                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| First enrollment      | identity verified -> LIVENESS_REQUIRED -> capture -> reference LINKED -> AUTO_VERIFIED                                  |
| Refresh/polling       | flow resumes; no id in URL/storage; foreign flowId denied                                                               |
| Session ownership     | user B's flowId denied for user A (real ids)                                                                            |
| Reference creation    | one FaceReferenceRecord, status LINKED, exact FaceId stored                                                             |
| Cover match           | matching cover -> PASSED                                                                                                |
| Gallery check         | lifestyle allowed, unrelated flagged                                                                                    |
| Rotation              | expiry -> LIVENESS_REQUIRED -> re-capture -> new referenceVersion, old FaceId deleted                                   |
| DB failure after mint | injected link failure -> LINK_FAILED record retains FaceId -> reconciler deletes it (no orphan)                         |
| Queue duplication     | two workers -> one provider run (lease)                                                                                 |
| Deletion              | account delete -> DeleteFaces for ALL FaceIds -> `SearchFaces`/`ListFaces` no longer returns them (externally verified) |
| Consent withdrawal    | same as deletion for the reference                                                                                      |
| Re-enrollment         | after deletion, new capture mints a fresh reference                                                                     |
| Provider outage       | breaker opens; jobs park; no auto-reject; recovery drains                                                               |

## Deletion completeness — external verification

After `deleteAllUserReferences`, independently confirm each FaceId is gone
at AWS: for every registry `externalFaceId`, a `SearchFaces` (or
`ListFaces` page scan) must NOT return it. Record only the FaceId-absent
result (never biometric media). A residual FaceId is a launch blocker.

## Evidence handling

- No biometric media, images, or raw similarity scores committed or
  logged. Record: pass/fail per scenario, FaceId-absent confirmations,
  normalized latencies, and the ReferenceImage-availability answer.
- Tear down the staging collection (`DeleteCollection`, admin credential)
  when the run completes.

## Exit criteria (all required before real-provider GO)

- ReferenceImage is reliably available (or config + notice updated).
- Full matrix passes on the staging collection.
- Deletion completeness externally verified (zero residual FaceIds).
- No cross-user session access observed with real ids.
