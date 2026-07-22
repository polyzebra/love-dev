# Face Verification — Calibration Report (Production Draft)

| | |
|---|---|
| Document Version | 1.0 (draft) |
| Status | **Draft — measurements PENDING real testing** |
| Prepared By | WiseWave Limited (Data Science + Trust & Safety) |
| Last Updated | 2026-07-21 |
| Effective Date | Pending Approval |
| Approved By | Pending |
| Calibration version (`FACE_CALIBRATION_VERSION`) | **Pending** (e.g. `cal-2026-07-v1` — set on approval) |

> This is the report **structure** required before `FACE_CALIBRATION_APPROVED=1`
> and `FACE_CALIBRATION_VERSION=<version>` may be set. **No test results are
> fabricated.** Every measured field is **[Pending]** until a real labelled run
> under `npm run face:calibrate` is reviewed and approved by a named owner.
> Unit tests are **not** calibration. Tooling + workflow: `docs/CALIBRATION.md`,
> `docs/FACE-CALIBRATION.md`.

## 1. Purpose

Measure real AWS Rekognition performance (FAR / FRR / precision / recall) for
Tirvea's profile-photo verification against a labelled dataset, and recommend the
production thresholds — without weakening production security. Approval of this
report is one of the three gates (`faceMatchLegalGate()`) that unblock production.

## 2. Model / provider

- Provider: **AWS Rekognition** (Face Liveness + Collections), `FACE_MATCH_PROVIDER=aws_rekognition_faces`.
- Model version: `FACE_MODEL_VERSION` = **[record actual, e.g. 7.0]**.
- Region: `eu-west-1`. Calibration collection: `FACE_CALIBRATION_COLLECTION_ID`
  (must be named `*calibration*` and differ from the production `FACE_COLLECTION_ID`).
- Comparison ops: `DetectFaces` + `SearchFacesByImage` → coarse band.

## 3. Dataset description

| Field | Value |
|---|---|
| Sample count (pairs) | **[Pending]** |
| Positive (same-person) pairs | **[Pending]** |
| Negative (different-person) pairs | **[Pending]** |
| Label source / methodology | **[Pending]** |
| Manifest | `data/calibration/manifest.example.json` format; every biometric sample MUST carry a `consentRef` (tooling refuses samples without one) |

## 4. Lawful source of test data

**[Pending]** — must be one of: explicitly consented contributor data (with
`consentRef`), licensed evaluation dataset, or synthetic data. **Must not** use
production users' biometric data without a lawful basis. Record the basis + evidence.

## 5. Coverage

| Dimension | Target | Measured |
|---|---|---|
| Lighting (bright/normal/low) | all three | **[Pending]** |
| Devices (iOS/Android, front cameras) | representative spread | **[Pending]** |
| Operating systems (iOS Safari, Android Chrome) | both | **[Pending]** |
| Ethnicity coverage + fairness analysis | representative; per-group FAR/FRR | **[Pending]** |
| Age coverage (18+) | representative | **[Pending]** |
| Movement / motion conditions | included | **[Pending]** |

Bias/fairness note: per-group FAR/FRR must be reported; a materially worse group
result blocks approval (ties to DPIA R6).

## 6. Results (measured — PENDING)

| Metric | Operating point | Value |
|---|---|---|
| False Accept Rate (FAR) | at chosen thresholds | **[Pending]** |
| False Reject Rate (FRR) | at chosen thresholds | **[Pending]** |
| False cover-mismatch rate | acceptance target **< 1%** on labelled sample | **[Pending]** |
| Precision / Recall | | **[Pending]** |
| Manual-review band rate | operationally affordable for staff | **[Pending]** |

## 7. Threshold selection

Config-driven (`src/lib/services/face-thresholds.ts`). Current defaults (to be
confirmed/replaced by the approved run):

| Env var | Default | Meaning |
|---|---|---|
| `FACE_MATCH_THRESHOLD` | 0.85 | at/above → confident owner match |
| `FACE_MISMATCH_THRESHOLD` | 0.4 | at/below (good quality) → confident non-owner |
| `FACE_MANUAL_REVIEW_MIN` | =mismatch | lower bound of manual-review band |
| `FACE_MIN_QUALITY` | 0.5 | below → uncertain, never auto-decided |
| `FACE_AWS_MATCH_SIMILARITY` | 92 | AWS similarity → match |
| `FACE_AWS_MISMATCH_SIMILARITY` | 70 | AWS similarity → mismatch |

Chosen production values: **[Pending approval]**.

## 8. Retry policy

A failed liveness attempt creates a **fresh** session (new `flowId`); the camera
reopens. Attempts are counted; a maximum-attempts cap is **[flagged — confirm]**.
Matches implementation (L8.3.5 fix).

## 9. Manual review / escalation policy

Ambiguous outcomes (flagged/uncertain cover, multiple faces, low confidence, critical
composite risk) → human `MANUAL_REVIEW` (perm `verifications:review`). Confident
adverse outcomes → auto-decided + appealable. Dead-lettered checks escalate to humans.

## 10. Known limitations

- Accuracy depends on capture conditions (lighting/movement) — mitigated by liveness + guidance.
- Coarse bands are intentionally lossy (privacy) — no raw scores to users.
- Demographic performance must be validated per §5; **[Pending]**.
- Vendor model upgrades (`FACE_MODEL_VERSION`) invalidate this calibration (see §12).

## 11. Future review schedule

Recalibrate + re-approve on: provider/model-version change, a sustained
`manual_review_spike` / `false_positive_spike` alert (`docs/FACE-ALERTING.md`), or a
materially different population after a geographic rollout expansion. Otherwise review
at least annually.

## 12. Version & approval

- `FACE_CALIBRATION_VERSION` (immutable report id): **[set on approval]**.
- `FACE_CALIBRATION_APPROVED=1`: set **only** after a human approves a real report.

| Role | Decision | Name | Date | Ref |
|---|---|---|---|---|
| Data Science | Report authored, measurements real | | | |
| Approver (Trust & Safety / Eng lead) | Approve thresholds + version | | | |

**No approval may be recorded until §3–§6 contain real measured values.**
