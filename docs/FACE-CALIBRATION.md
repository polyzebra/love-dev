# Face Verification — Calibration Guide

How to calibrate the per-provider match thresholds from labelled samples and
record an **approved** calibration. This is **state 4 (calibrated)** on the
status board in FACE-VERIFICATION-RUNBOOK.md.

> Calibration is a human sign-off, not a switch. `face:calibrate` only
> **recommends** a versioned threshold set — it never writes thresholds and
> never enables anything. A person reviews the report, applies the approved
> values as env vars, and records the approval. Current status: **pending**.

## Why per-provider

The mock and AWS providers return scores on different scales. Every threshold
is config-driven (`src/lib/services/face-thresholds.ts`) so a provider swap or
a recalibration re-scores every photo. The thresholds that matter:

| Env var | Default | Meaning |
|---------|---------|---------|
| `FACE_MATCH_THRESHOLD` | 0.85 | at/above → confident owner match |
| `FACE_MISMATCH_THRESHOLD` | 0.4 | at/below (good quality) → confident non-owner |
| `FACE_MANUAL_REVIEW_MIN` | =mismatch | lower bound of the manual-review band |
| `FACE_MIN_QUALITY` | 0.5 | below → "uncertain", never auto-decided |
| `FACE_MANIPULATION_RISK_THRESHOLD` | (unset→old name) | at/above → manipulation suspected |
| `FACE_AWS_MATCH_SIMILARITY` | 92 | AWS SearchFaces similarity → match |
| `FACE_AWS_MISMATCH_SIMILARITY` | 70 | AWS similarity → mismatch |
| `FACE_THRESHOLD_VERSION` / `FACE_CALIBRATION_VERSION` | v0 | the label stamped into every cached verdict |

## Procedure

1. **Assemble a labelled manifest.** A JSON manifest of sample comparisons
   with ground-truth labels. Biometric samples MUST carry a `consentRef`;
   the tool refuses samples without one, and refuses to run in production.
   See `data/calibration/manifest.example.json`.

2. **Run the calibrator (dry, no AWS writes, no threshold writes):**

   ```
   npm run face:calibrate -- --manifest <path> [--json] [--out reports/calibration]
   ```

   It re-scores captured comparisons under candidate thresholds (no new AWS
   calls), estimates false-cover-mismatch and manual-review rates, and writes
   a versioned JSON + Markdown report. Cost estimates use
   `FACE_AWS_COST_PER_CALL` (default 0.001 USD/call).

3. **Review the report.** Acceptance target: **< 1% false cover mismatch** on
   the labelled sample (Production readiness checklist). Confirm the
   manual-review band is operationally affordable for staff.

4. **Apply the approved thresholds** as env vars in the target environment,
   and bump `FACE_CALIBRATION_VERSION` (or `FACE_THRESHOLD_VERSION`) so cached
   verdicts re-run under the new calibration.

5. **Record the approval** — set `FACE_CALIBRATION_APPROVED=1`. This, plus a
   non-empty threshold version, is what the rehearsal `calibration_approved`
   gate checks. Do not set it until a human has genuinely approved a report.

## What calibration does NOT do

- It does **not** apply thresholds (a human does, deliberately).
- It does **not** grant legal approval (state 3) — that is separate counsel
  sign-off, see the DPIA and FACE-VERIFICATION-RUNBOOK.md.
- It does **not** roll the layer out (state 6) — that is
  `FACE_VERIFICATION_PERCENT`.

## Recalibration triggers

Recalibrate (and re-approve) on: a provider or model-version change
(`FACE_MODEL_VERSION`), a sustained `manual_review_spike` /
`false_positive_spike` alert (FACE-ALERTING.md), or a materially different
population after a geographic rollout expansion.
