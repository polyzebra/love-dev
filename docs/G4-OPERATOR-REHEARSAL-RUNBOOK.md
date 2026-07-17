# G4.1 — Operator Rehearsal Runbook (Device, Spoof & Performance)

Self-contained. An operator can follow this **without repository knowledge** to
close the remaining G4 blockers on **staging**. It never touches production and
never retains biometric images. Record every result in the PASS/FAIL template.

> Rule: **Do not claim PASS without captured evidence.** Latency **targets**
> below are engineering targets, NOT measurements — fill the measured columns
> from your own run.

---

## 1. Preconditions

Staging only. Confirm before starting:

- [ ] `https://staging.tirvea.com/api/health` returns `{"status":"healthy","database":"ok","config":"ok","billing":"ok"}`.
- [ ] Staging env: `FACE_ENVIRONMENT=staging`, `FACE_MATCH_PROVIDER=aws_rekognition_faces`, `FACE_LIVENESS_ENABLED=1`, `AWS_REKOGNITION_REGION=eu-west-1`, `VERIFICATION_PROVIDER=stripe_identity` (Stripe **test** mode is acceptable on staging), `FACE_VERIFICATION_PERCENT>0` **or** the tester on `FACE_INTERNAL_USER_ALLOWLIST`.
- [ ] `FACE_THRESHOLD_VERSION` and `FACE_CALIBRATION_VERSION` are set to the version under test (record them).
- [ ] AWS: the staging Rekognition collection exists in eu-west-1; the liveness STS role is assumable (G2 verified).
- [ ] A **separate** calibration collection exists for §9 (`FACE_CALIBRATION_COLLECTION_ID`, `*calibration*`, ≠ prod).
- [ ] Consent forms for every human subject are recorded (a `consentRef` per subject).
- [ ] Access to: the staging admin console (manual review), the staging DB read replica (status/audit checks), CloudWatch/Stripe/AWS dashboards (latency + audit).

**Endpoints the operator observes** (staging origin):
`POST /api/verification/photo/start` · `GET /api/verification/photo/status` ·
`POST /api/verification/liveness` · `GET /api/verification/liveness/{flowId}` ·
`POST /api/verification/liveness/{flowId}/capture` ·
`POST /api/verification/consent/withdraw` · `POST /api/webhooks/verification`.

**State machines the operator checks:**
- Identity `Verification.status`: `PENDING → IN_REVIEW → APPROVED | REJECTED | EXPIRED`.
- `LivenessSession.status`: `CREATED → PROCESSING → PASSED | FAILED | EXPIRED | INVALIDATED`, then `CONSUMED` once linked.
- `ProfilePhotoVerification.status`: `LIVENESS_REQUIRED → QUEUED → CLAIMED → CHECKING → AUTO_VERIFIED | MANUAL_REVIEW | REJECTED | SUSPENDED`.
- `FaceBadgeStatus`: `NONE | REVIEWING | ACTIVE | SUSPENDED`.
- `FaceCheckClassification`: `OWNER_MATCHED | NO_FACE | GROUP_PHOTO | OTHER_PERSON_ONLY | UNCERTAIN`.
- Audit (`VerificationAuditEvent.eventType`): `liveness_session_created`, `liveness_required`, `liveness_passed`, `liveness_failed`, `face_check_run`, `duplicate_check`, `face_auto_suspend`, `photo_grant_granted`, `photo_grant_cleared`, `photo_grant_refused`, `face_consent_withdrawn`, `face_data_deleted`.

---

## 2. Test accounts (clean, collision-free)

Generate **one RUN ID per rehearsal**: `RUN=$(date +%Y%m%d-%H%M%S)-$RANDOM`.

- Emails: `g41-${RUN}-<tag>@staging.tirvea.test` (unique per subject).
- Phones: a dedicated staging test-number pool, one per subject; never reuse across concurrent runs (avoids the `unique(phone)` collision).
- One `subjectId` per human tester; one `consentRef` per subject: `consent://rehearsal/${RUN}/<subject>`.
- Record the mapping `subject → email/phone/consentRef` in the run log.

Rerun safety: a fresh `RUN` each time guarantees no residue collision. Always run §8 cleanup at the end (and after any aborted run).

---

## 3. Device matrix

Run the **full column of §2 checks** on each browser. Mark P/F/NA per cell.

| Browser | camera perm | camera denied | liveness start | liveness complete | refresh | back nav | multi-tab | net interrupt | retry | face match | badge update | discovery | chat perm | logout/login resume |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| iPhone Safari |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| iPhone Chrome |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Android Chrome |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Samsung Internet |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Desktop Chrome |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Desktop Safari |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Desktop Edge |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Desktop Firefox |  |  |  |  |  |  |  |  |  |  |  |  |  |  |

**Per-check expected state (PASS criteria):**
| Check | Steps | Expected result | Evidence |
|---|---|---|---|
| camera permission | start liveness; allow camera | prompt shown; stream starts; `LivenessSession=CREATED`, audit `liveness_session_created` | screenshot + session id |
| camera denied | deny camera | graceful error, no crash; `ProfilePhotoVerification` stays `LIVENESS_REQUIRED`; no reference | screenshot |
| liveness start | begin challenge | `CREATED→PROCESSING` | status poll |
| liveness complete | finish challenge | AWS `SUCCEEDED`→ `PASSED`→`CONSUMED`; audit `liveness_passed` | status + audit |
| refresh | reload mid-flow | resumes or restarts cleanly; no duplicate reference; single `CONSUMED` | DB row count |
| back nav | browser back | no orphaned/duplicate session; state consistent | DB |
| multi-tab | open flow in 2 tabs | one session consumes; the other returns the existing result (idempotent), never a 2nd reference | DB (one `CONSUMED`) |
| net interrupt | drop wifi mid-capture | session `PROCESSING`/times out to `EXPIRED`; retry available; no partial reference | status |
| retry | re-attempt after failure | new liveness session; prior invalidated; success links exactly one reference | DB |
| face match | approved cover of the owner | worker `face_check_run`→`AUTO_VERIFIED`; classification `OWNER_MATCHED`; `photo_grant_granted` | audit |
| badge update | after match | `FaceBadgeStatus=ACTIVE`; badge visible on profile | screenshot |
| discovery | as another user | verified badge shows in swipe/explore; **suspended never shows verified** | screenshot |
| chat perm | open a conversation | badge renders in chat header; permissions unchanged | screenshot |
| logout/login resume | log out then back in | verified state persists; no re-verification demanded | screenshot |

**FAIL criteria (any):** a spoof/denied/interrupted path yields a reference or `ACTIVE` badge; a duplicate reference is created; a crash/hang; suspended user shows verified anywhere.

---

## 4. Spoof matrix (live presentation attacks)

Use **only** consented subjects and legally-permitted synthetic media. Every spoof must be **rejected**. Capture the AWS liveness `Status` + `Confidence`.

| # | Scenario | Operator steps | Expected app state | Expected AWS/Stripe | Expected DB status | Expected audit | PASS | FAIL | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Printed photo | hold a printed photo of the subject to the liveness camera | liveness fails; no reference | Rekognition liveness `FAILED` | `LivenessSession=FAILED`; PPV `LIVENESS_REQUIRED` | `liveness_failed` | liveness FAILED, no reference, badge `NONE` | liveness `SUCCEEDED` | screenshot + session id + status |
| 2 | Photo on another phone | show the subject's photo on a 2nd phone screen | liveness fails | liveness `FAILED` | `FAILED` | `liveness_failed` | rejected | passed | screenshot |
| 3 | Prerecorded video replay | play a recorded clip of the subject | liveness fails | liveness `FAILED` | `FAILED` | `liveness_failed` | rejected | passed | screenshot |
| 4 | Tablet replay | replay on a tablet | liveness fails | liveness `FAILED` | `FAILED` | `liveness_failed` | rejected | passed | screenshot |
| 5 | Monitor replay | replay on a desktop monitor | liveness fails | liveness `FAILED` | `FAILED` | `liveness_failed` | rejected | passed | screenshot |
| 6 | Cropped face | present a cropped face image | liveness fails / low quality | `FAILED` or no enroll | `LIVENESS_REQUIRED` | `liveness_failed` | no reference | reference created | screenshot |
| 7 | Partial face | occlude half the face during capture | liveness fails / retry | `FAILED`/retry | `LIVENESS_REQUIRED` | `liveness_failed` | no auto-verify | auto-verified | screenshot |
| 8 | Multiple faces (cover) | set a group photo as the cover after a genuine liveness | cover flagged | match search | PPV `MANUAL_REVIEW`; class `GROUP_PHOTO`/`UNCERTAIN` | `face_check_run` (not granted) | routed to review, badge not `ACTIVE` | auto-verified | audit + status |
| 9 | Different person (cover) | genuine liveness for A, then set B's photo as cover | cover rejected | mismatch | PPV `REJECTED`; class `OTHER_PERSON_ONLY`; `photo_grant_cleared` | `face_check_run` | rejected, no badge | accepted | audit + status |
| 10 | Close family / twin | enroll subject A; probe with a close relative/twin as cover | not auto-verified | mid/high similarity | PPV `MANUAL_REVIEW` (or `REJECTED`); **record similarity** | `face_check_run` | not auto-accepted | auto-verified | similarity value + status |
| 11 | AI-generated / face-swap (if permitted) | present synthetic/face-swapped media to liveness | liveness fails / manipulation flag | liveness `FAILED` or manipulation risk | `FAILED` / flagged | `liveness_failed` | rejected | passed | screenshot |

**Also verify (session integrity):**
- Reused verification URL / expired session replay → foreign/expired `flowId` returns not-found/`EXPIRED`; a `CONSUMED` session replay returns the **existing** result, never a new reference.
- Cross-account replay → subject B cannot consume subject A's liveness `flowId` (ownership bound); attempt → refused, no enrollment for B.

---

## 5. Failure recovery

| Scenario | Steps | Expected safe recovery | Evidence |
|---|---|---|---|
| AWS timeout | run during an induced Rekognition delay (or observe a natural one) | job parked `QUEUED`/`CHECKING`, retried; never a fabricated match | audit + status |
| AWS throttling | drive concurrent checks | circuit breaker opens; `face_check_error`/park; recovers on cooldown | audit |
| STS expiration | let streaming creds age past TTL mid-capture | capture ends; retry issues fresh creds | screenshot |
| Expired identity session | leave a Stripe session unfinished past expiry | `Verification=EXPIRED`; retry available | status |
| Duplicate webhook | replay the same Stripe/identity webhook | idempotent — second delivery `already_applied`, no double side effects | webhook 200 + DB unchanged |
| Out-of-order webhook | deliver `verified` before `processing` | final state correct (refetch-latest) | status |
| Network retry | drop/restore network on the status poll | poll resumes; no duplicate state | status |
| Browser refresh / back / multi-tab | §3 checks | single reference; idempotent | DB |
| Session restore | logout/login | verified state persists | screenshot |

---

## 6. Latency capture

Measure on staging with real AWS/Stripe. **Targets are targets, not results.**

| Measurement | Source | p50 TARGET | p95 TARGET | p50 MEASURED | p95 MEASURED |
|---|---|---|---|---|---|
| Stripe Identity session creation | `POST /verification/photo/start` | < 800 ms | < 2000 ms |  |  |
| Face Liveness session creation | `CreateFaceLivenessSession` | < 600 ms | < 1500 ms |  |  |
| STS credential issuance | `AssumeRole` | < 500 ms | < 1200 ms |  |  |
| Liveness completion (user-paced) | capture → `SUCCEEDED` | < 8 s | < 15 s |  |  |
| Face reference creation | `IndexFaces` | < 700 ms | < 1800 ms |  |  |
| Face match | `DetectFaces`+`SearchFacesByImage` | < 900 ms | < 2500 ms |  |  |
| Badge update | grant write | < 200 ms | < 500 ms |  |  |
| Total end-to-end | start → badge `ACTIVE` | < 30 s | < 60 s |  |  |
| Retry path | failed → verified | < 15 s | < 30 s |  |  |

Collect ≥ 20 runs per row for a meaningful p50/p95. Source server timings from CloudWatch / app logs (no biometric content), STS/Stripe from their dashboards.

---

## 7. Evidence checklist (per scenario)

- [ ] Screenshot of the user-facing state.
- [ ] `Verification` / `ProfilePhotoVerification` / `LivenessSession` status (DB read).
- [ ] The relevant `VerificationAuditEvent` row(s) (type + timestamp only).
- [ ] AWS liveness `Status` (+ `Confidence` for spoofs).
- [ ] Similarity value for close-family/twin (§4 #10).
- [ ] Latency numbers (§6).
- [ ] Device/browser + OS version, lighting condition.
- [ ] **Never** capture the biometric image, the reference frame, FaceIds, or any secret.

---

## 8. Data cleanup protocol

Run after **every** rehearsal (and after any aborted run):

- [ ] Delete all `g41-${RUN}-*` test users (cascades: profile, photos, `ProfilePhotoVerification`, `LivenessSession`, `FaceReferenceRecord`, `Verification`, audit, notifications).
- [ ] Withdraw + delete face data for each subject (`POST /verification/consent/withdraw`, then teardown) so provider references are deleted at AWS.
- [ ] `npm run calibration:clean` to purge the calibration collection (§9).
- [ ] Verify zero residue: no `g41-${RUN}-*` rows; calibration collection empty; no orphaned liveness sessions.
- [ ] Release the test phone numbers back to the pool.

Collision prevention: unique `RUN` per run + dedicated phone pool + cascade cleanup ⇒ reruns never hit `unique(email)`/`unique(phone)`.

---

## 9. Calibration-data export (closes G3.1)

For **every** liveness/match attempt, record an outcome row — **metrics only, no image**:

`consentRef, scenario label, device/browser, lighting, groundTruth(match|nonmatch), result(accept|reject|review), similarity, livenessConfidence, qualityScore, reviewOutcome`.

Then run the gated calibration tooling (G3.2) against the **calibration** collection:

```bash
FACE_ENVIRONMENT=staging FACE_CALIBRATION_MODE=1 \
FACE_CALIBRATION_COLLECTION_ID=<dedicated *calibration* collection> \
npm run calibration:run -- --manifest data/calibration/<datasetVersion>/manifest.json
# -> reports/calibration/calibration-run-*.json : measured FAR/FRR/precision/recall + per-label/device/demographic
# -> auto-deletes every indexed calibration face on completion
```

Manifest fields per sample: `subjectId, consentRef, datasetVersion, captureTimestamp, scenario, device{platform,model}, demographic?, truth, imagePath` (images live outside git, never committed). Review measured FAR/FRR → pick a threshold profile → apply the approved `FACE_*` values + a new `FACE_CALIBRATION_VERSION` (human approval; the tooling never writes thresholds). **No biometric image is retained** at any step.

---

## 10. PASS/FAIL template (per row)

```
Scenario:            <device/browser | spoof # | recovery | latency>
Subject / RUN:       <subject> / <RUN>
Steps executed:      <...>
Observed app state:  <...>
AWS/Stripe outcome:  <liveness Status / Confidence / session>
DB status:           Verification=<> PPV=<> Liveness=<> Badge=<>
Audit event(s):      <eventType @ ts>
Latency (if any):    <measurement = value>
Evidence:            <screenshot/log refs>
Result:              PASS | FAIL | NOT VERIFIED
Notes:               <...>
```

---

## Remaining blockers (to move G4 → GO)

1. **Device matrix (§3)** executed on all 8 browsers — all critical cells PASS.
2. **Spoof matrix (§4)** executed — all 11 rejected; session-integrity checks PASS.
3. **Failure recovery (§5)** executed — every scenario recovers safely.
4. **Latency (§6)** — ≥20 runs/row; measured p50/p95 within target (or documented exceptions).
5. **Calibration (§9 / G3.1)** — measured FAR/FRR within target; `FACE_CALIBRATION_VERSION` assigned + applied.
6. **App-side liveness-confidence floor** (G3.1 recommendation) added before the spoof run for defense-in-depth.

---

## Final verdict

## ✅ G4.1 READY FOR OPERATOR RUN

This runbook is complete and executable on staging: preconditions, collision-free test accounts, the 8-browser device matrix, the 11-scenario spoof matrix, failure-recovery, latency capture with clearly-separated targets, an evidence checklist, a residue-proof cleanup protocol, calibration-data export wired to the G3.2 tooling, and a PASS/FAIL template. It fabricates no results and claims no PASS without operator evidence. Executing it and recording the evidence closes the remaining G4 blockers (device, spoof, latency) and feeds G3.1 calibration. No production or infrastructure was modified; nothing committed or pushed.
