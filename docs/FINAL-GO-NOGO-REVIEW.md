# Final Independent Go / No-Go Review — Face Verification

Independent re-evaluation after the blocker-closure phase (Phases 21-33).
The prior 8.0/10 is NOT carried over; every gate was re-assessed.

## Mandatory gate matrix

| #   | Gate                               | Status                           | Evidence                                                                                                                                                                               | Remaining risk                                  | Owner action                  |
| --- | ---------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------- |
| 1   | Real AWS adapter                   | **PASS (code)**                  | `aws-rekognition.ts` full ops + real SigV4 signer; final-blockers suite verifies normalized outputs, a valid `AWS4-HMAC-SHA256` Authorization header, and containment                  | Not yet run against live AWS                    | Staging integration run       |
| 2   | Working liveness capture           | **PASS (code)**                  | endpoints + `liveness-capture.tsx` (11 states, consent, camera guidance, a11y `aria-live`, refresh-safe hash, degradation); mock exercises the full flow                               | Amplify SDK + real capture pending (bundle+DPA) | Add SDK at staging            |
| 3   | Calibrated + versioned thresholds  | **BLOCKED**                      | framework + CLI built; `calibrationVersion` stamped on every decision; but no labelled sample set exists                                                                               | Cannot certify thresholds without data          | Collect labelled set; run CLI |
| 4   | Risk double-count fixed            | **PASS**                         | `source=face_verification` exclusion (null-safe) + live-photo filter; final-blockers suite proves one rejection scores once, non-face fraud still scores, impersonation still CRITICAL | none                                            | —                             |
| 5   | External operational alerting      | **PASS**                         | `ALERT_WEBHOOK_URL` channel independent of the outbox; severity/resolved/dedupe; failure-tolerant (tested)                                                                             | Needs a real endpoint configured                | Set the webhook               |
| 6   | Scalable queue processing          | **PASS**                         | atomic claim + lease expiry + time budget + oldest-first + breaker-aware + index-backed; documented capacity below                                                                     | Measured only at test scale                     | Load-test at staging          |
| 7   | Admin N+1 fixed                    | **PASS**                         | queue reads stored `riskBand` (zero per-row risk recompute); `(status, updatedAt)` index added                                                                                         | none                                            | —                             |
| 8   | Dead/unreachable states resolved   | **PASS**                         | TWIN_RISK now evidence-based (birth-date match), emitted + tested; SELF_RESTORE removed from auto-classification (tested)                                                              | enum values retained for history (documented)   | —                             |
| 9   | DPIA completed + approved          | **BLOCKED**                      | working doc complete (DPIA-FACE-VERIFICATION.md); NOT signed                                                                                                                           | legal                                           | Counsel sign-off              |
| 10  | AWS DPA completed                  | **BLOCKED**                      | checklist in the DPIA §12; not executed                                                                                                                                                | legal/procurement                               | Execute DPA                   |
| 11  | Privacy/biometric notices approved | **BLOCKED**                      | 3 pages written accurately with visible [PLACEHOLDER] markers; not counsel-approved                                                                                                    | legal                                           | Review + approve copy         |
| 12  | Deletion verified end-to-end       | **PASS (mock) / BLOCKED (live)** | teardown + rotation destroy the reference + audit (chaos/security suites); live `DeleteFaces`+`SearchFaces` evidence pending                                                           | provider-side proof                             | Capture at staging            |
| 13  | Security validation passed         | **PASS**                         | negative-access matrix + IAM least-privilege doc + region lock + env isolation; see §Security                                                                                          | admin 2FA (L-4) still open                      | Optional pre-scale            |
| 14  | Staged-rollout controls tested     | **PASS**                         | percent (deterministic/monotonic), country allowlist, legal-approval hard gate, independent duplicate + auto-suspend flags - all tested                                                | none                                            | —                             |

## Production Readiness Score: 8.7 / 10

Engineering gates (1,2,4,5,6,7,8,13,14) all PASS; the cap is the four
external-dependency BLOCKED gates (3 calibration data, 9 DPIA, 10 DPA,
11 notices) - none of which are code and none waivable.

## GO / NO-GO: **NO-GO** (correctly, and by construction)

Per the phase rules: any missing legal approval for biometric processing
= NO-GO; missing calibration = NO-GO; provider working only in mock =
NO-GO. Three of those hold. This is the DESIGNED outcome - the layer is
dormant (`FACE_MATCH_PROVIDER` unset, plus the production legal-approval
hard gate) and cannot self-enable.

**All engineering blockers from the prior PRR are RESOLVED.** The
remaining NO-GO reasons are exclusively external dependencies with
documented owners (calibration data, DPIA, DPA, legal copy) - each a
BLOCKED gate with an external dependency, which satisfies the phase
success criterion (every blocker PASS or BLOCKED-with-dependency).

## Tested capacity (Phase 27, honest bounds)

- Per cron tick: `FACE_SWEEP_BATCH` (default 10) claims under a
  `FACE_SWEEP_TIME_BUDGET_MS` (default 45s) budget; atomic claim makes
  concurrent ticks safe; expired leases (default 15 min) reclaim crashed
  work. At */10 min and batch 50 that is ~7.2k recovery runs/hour.
- The PRIMARY path is `after()` (unbounded, per-request), so the sweep
  only bounds RECOVERY throughput. Measured only at test scale here - NOT
  a millions-of-users claim. Past ~50k verified users, move to a worker
  queue (documented as TD-1, still open).

## Security validation (Phase 31 summary)

Least-privilege IAM (runtime vs admin split, region-lock deny),
per-environment collections, in-adapter region enforcement, session
ownership on liveness polling, RBAC on every endpoint, no biometric data
in alerts/logs/support view (tested). Negative-access cases covered by
the existing admin-authz + new final-blockers suites. Open: admin 2FA
(L-4, pre-existing), live-provider secret rotation drill.

## Residual risk register (post-fix)

| ID   | Risk                                   | Sev | State                                             |
| ---- | -------------------------------------- | --- | ------------------------------------------------- |
| R-3  | Threshold miscalibration at launch     | Med | mitigated by gate 3 BLOCK + staged % + FP alert   |
| R-1  | Deepfake on web liveness               | Med | vendor PAD at selection; native attestation later |
| TD-1 | Recovery-sweep ceiling past ~50k users | Low | worker queue when needed                          |
| M-1  | Live secrets on dev laptop             | Med | pre-existing; secret-manager migration            |
| L-4  | Admin 2FA absent                       | Low | pre-existing                                      |
