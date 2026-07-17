# Face Verification — Calibration Workflow (G3.2)

Dedicated, **production-locked** tooling to measure real AWS Rekognition
performance (FAR / FRR / precision / recall) against a labelled dataset, then
recommend production thresholds — **without weakening production security**.

Production stays exactly as designed: the AWS provider's `createReference` is
**liveness-only** and is unchanged. Static `IndexFaces` enrollment is possible
**only** through the gated calibration path below, and only against a dedicated
calibration collection that is never the production collection.

## Safety model (fail closed)

Every calibration command calls `assertCalibrationMode()` first. It refuses
unless **all** of these hold:

1. `FACE_ENVIRONMENT` != `production` **and** `NODE_ENV` != `production`
2. `FACE_CALIBRATION_MODE=1`
3. `FACE_CALIBRATION_COLLECTION_ID` is set, is explicitly named `*calibration*`,
   and is **different** from `FACE_COLLECTION_ID` (the production collection).

If any check fails the command exits non‑zero and does nothing. Production
FaceIds and calibration FaceIds can never be mixed (separate collections). No
biometric image is ever stored — reports contain labels, scenario/device/
demographic tags and metrics only.

## Environment

```
FACE_ENVIRONMENT=staging                 # must NOT be production
FACE_CALIBRATION_MODE=1
FACE_CALIBRATION_COLLECTION_ID=tirvea-faces-calibration-staging   # != FACE_COLLECTION_ID
FACE_MATCH_PROVIDER=aws_rekognition_faces    # or "mock" for a dry-run
FACE_CALIBRATION_VERSION=cal-<dataset>-<yyyymm>
# AWS_* runtime creds + AWS_REKOGNITION_REGION=eu-west-1 as usual
```

## Dataset structure

The dataset lives **outside** the repository and is never committed. A manifest
references consented, labelled captures:

```
data/calibration/<datasetVersion>/manifest.json
data/calibration/<datasetVersion>/images/<id>.jpg     # consented; never committed
```

`manifest.json`:

```json
{
  "datasetVersion": "ds-2026-08",
  "environment": "staging",
  "samples": [
    {
      "id": "ref-A",
      "subjectId": "subjA",
      "role": "reference",
      "scenario": "enrollment",
      "device": { "platform": "iPhone", "model": "15" },
      "consentRef": "consent://calibration/2026-08/subjA",
      "datasetVersion": "ds-2026-08",
      "captureTimestamp": "2026-08-01T10:00:00Z",
      "imagePath": "data/calibration/ds-2026-08/images/ref-A.jpg"
    },
    {
      "id": "A-daylight",
      "subjectId": "subjA",
      "role": "probe",
      "truth": "match",
      "label": "daylight",
      "scenario": "daylight",
      "device": { "platform": "iPhone" },
      "demographic": { "group": "g1" },
      "consentRef": "consent://calibration/2026-08/subjA",
      "datasetVersion": "ds-2026-08",
      "captureTimestamp": "2026-08-01T10:05:00Z",
      "imagePath": "data/calibration/ds-2026-08/images/A-daylight.jpg"
    },
    {
      "id": "X-impostor",
      "subjectId": "subjA",
      "role": "probe",
      "truth": "nonmatch",
      "label": "different_person",
      "scenario": "impostor",
      "device": { "platform": "Android" },
      "consentRef": "consent://calibration/2026-08/subjX",
      "datasetVersion": "ds-2026-08",
      "captureTimestamp": "2026-08-01T10:06:00Z",
      "imagePath": "data/calibration/ds-2026-08/images/X-impostor.jpg"
    }
  ]
}
```

Every sample requires `subjectId`, `consentRef`, `datasetVersion`,
`captureTimestamp`, `scenario`, and `device.platform` — **no anonymous
enrollment** (`validateCalibrationMeta` enforces this). `truth` (`match` /
`nonmatch`) on probes is the ground truth used for FAR/FRR.

The calibration CLI enrolls/compares through the gated low-level AWS primitives
(`calibrationIndexFace` / `calibrationCompare`), so it runs against a **real**
AWS calibration collection that must already exist (created once by ops as a
dedicated non-prod collection). The end-to-end pipeline logic — enrollment,
classification, measured metrics and cleanup — is validated deterministically in
`tests/calibration-tooling.test.ts` (injected transport, no AWS).

## Operator steps

```bash
# 1. Collect the consented, labelled dataset (see G3.1 capture protocol).
# 2. Ops creates the dedicated calibration collection once (CreateCollection,
#    admin credentials) and sets FACE_CALIBRATION_COLLECTION_ID to it.
# 3. Configure the calibration env (above).

# 4. Real run against AWS (enroll refs -> probe -> measure -> auto-clean):
npm run calibration:run -- --manifest data/calibration/ds-2026-08/manifest.json
#   writes reports/calibration/calibration-run-<dataset>-<ts>.json (metrics only)
#   and deletes every indexed calibration face on completion (--keep to retain)

# 5. Optional standalone steps:
npm run calibration:enroll -- --manifest <manifest>   # enroll only
npm run calibration:clean                              # purge ALL faces in the calibration collection
npm run calibration:report -- --in <report.json>      # print a report

# 6. Review measured FAR/FRR/precision/recall + per-label/device/demographic.
#    Choose a threshold profile and apply the approved FACE_* values + a new
#    FACE_CALIBRATION_VERSION to the environment (human approval required — the
#    tooling never writes thresholds).
```

## Reports & versioning

Each run writes a versioned, image-free JSON report carrying: `datasetVersion`,
`thresholdVersion`, `calibrationVersion`, `modelVersion`, `region`, `collection`,
`generatedAt`, `gitCommit`, measured `metrics` (TP/TN/FP/FN, FAR, FRR, precision,
recall, review rate) and per-label / per-device / per-demographic slices.

`FACE_CALIBRATION_VERSION` (e.g. `cal-ds-2026-08`) is stamped on every
production decision (`ProfilePhotoVerification.calibrationVersion` /
`PhotoFaceCheck`). **Change it whenever** thresholds, model version, region,
provider, or the calibrating dataset change.

## Rollback

Because the calibration version is stamped on every decision and each report is
archived (metrics only), any threshold change is reversible: re-pin the previous
`FACE_CALIBRATION_VERSION` and its `FACE_*` values from the archived report. No
production data is touched by calibration — the calibration collection is
separate and auto-purged.

## Cleanup guarantee

`calibration:run` deletes every face it indexed on completion (success or
failure) unless `--keep` is passed. `calibration:clean` purges the entire
calibration collection. No calibration biometric data remains indefinitely.
