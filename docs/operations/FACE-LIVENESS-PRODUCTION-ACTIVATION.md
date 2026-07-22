# Face Liveness — Production Activation Pack (L8.3.7)

> **Operator-ready runbook.** This document tells an authorized operator exactly
> which approvals, documents, version identifiers, environment variables, AWS
> checks, Vercel steps, deployment steps and physical-device acceptance test are
> required to activate AWS Face Liveness **legitimately**.
>
> **It contains NO secret values.** Every value is a placeholder pointing at its
> approval source. Setting any variable without the recorded approval behind it
> is a compliance breach — the runtime gate (`faceMatchLegalGate()`) is
> deliberately fail-closed so the layer cannot enable itself.
>
> **Current decision: `BLOCKED — LEGAL` (and `BLOCKED — CALIBRATION`).** See §12.
> Do not deploy until §2 evidence exists and §11 is signed.

Fix commit that must be deployed (or a descendant): **`17a698d`**
Contracting entity / data controller: **WiseWave Limited** (CRO 762171, 39 Cooley
Park, Dundalk, Co. Louth, A91 AP2V, Ireland) — brand **Tirvea**. Jurisdictions: IE + UK.
Processing region: **eu-west-1** (EU-only).

---

## 1. Preconditions

Activation may begin **only** when all of these hold:

1. The three compliance approvals in §2 exist as signed documents (legal
   approval + version, executed AWS DPA, approved calibration + version).
2. The `FACE_LEGAL_APPROVAL_VERSION` ↔ notice-version relationship in §3 is
   resolved (currently a **governance gap** — do not guess).
3. An authorized operator has Vercel Production env + canonical CI deploy access.
4. A supported physical phone (iPhone Safari; Android Chrome if available) over HTTPS.
5. A disposable eligible test account (registered; **no** Stripe Identity required — L9.1.2).

---

## 2. Approval evidence table

| Approval | Evidence required | Repo document | Repo status | Can set now? |
|---|---|---|---|---|
| **Legal approval + version** | Counsel sign-off of the Biometric Information Policy + DPIA; a recorded approval-package version | `docs/L5.1-BIOMETRIC-INFORMATION-POLICY-DRAFT.md`, `docs/DPIA-FACE-VERIFICATION.md` | **DRAFT / NOT APPROVED** (L5.1 `status: draft`, `effectiveDate: ""`; DPIA "WORKING DRAFT — NOT APPROVED", §13 unsigned) | ❌ No |
| **AWS DPA executed** | Executed/incorporated AWS Data Processing Addendum covering the WiseWave AWS account, eu-west-1, Rekognition | DPIA §6 lists AWS DPA as **"pending §13"** | **No executed-DPA evidence in repo** | ❌ No |
| **Calibration approved + version** | Signed calibration report with FAR/FRR, thresholds, coverage, immutable version | `docs/FACE-CALIBRATION.md`, `docs/CALIBRATION.md` | **"Current status: pending"** — no approved version recorded | ❌ No |

None of the three can be set today. See §12 for the resulting status.

---

## 3. Exact environment variables (Phase A map)

Format/consumer/source for every production variable. **Runtime = server** unless noted.

| Variable | Consumer (file) | Format | Fail-closed | Approval source | Present in repo? | Set now? |
|---|---|---|---|---|---|---|
| `FACE_MATCH_PROVIDER` | `src/lib/services/face-match-providers.ts:313` | `"aws_rekognition_faces"` | yes (empty→off) | Engineering (activation switch) | example only | ✅ safe |
| `FACE_LIVENESS_ENABLED` | `src/lib/services/face-rollout.ts:25` (+ liveness route) | `"1"` | yes | Engineering | example only | ✅ safe |
| `AWS_REGION` / `AWS_REKOGNITION_REGION` | `aws-rekognition.ts:48,174,445`; STS uses `AWS_REKOGNITION_REGION` `aws-sts.ts:33` | `eu-west-1` | region-pinned in adapter (`AWS_ALLOWED_REGIONS`) | Infra (must equal collection region) | example only | ✅ safe |
| `FACE_LIVENESS_ROLE_ARN` | `aws-sts.ts:36` | `arn:aws:iam::<ACCT>:role/TirveaFaceLivenessStreaming` | yes (STS unconfigured→null) | Infra/IAM (see §6) | example only | ✅ safe (points at real role) |
| `FACE_AWS_DPA_CONFIRMED` | `face-rollout.ts:165` | `"1"` | yes | **Legal/DPO — executed DPA (§4)** | **absent** | ❌ **blocked** |
| `FACE_CALIBRATION_APPROVED` | `face-rollout.ts:166` | `"1"` | yes | **Data science + approver — calibration (§5)** | **absent** | ❌ **blocked** |
| `FACE_CALIBRATION_VERSION` | `face-rollout.ts:167,33` | non-empty, e.g. `cal-2026-07-v1` | yes | **Calibration report version (§5)** | **absent** | ❌ **blocked** |
| `FACE_LEGAL_APPROVED_VERSIONS` | `face-rollout.ts:160` (`splitApprovedVersions`) | non-empty CSV, e.g. `2026-07-bio-v1` | yes | **Counsel — approved-version allowlist** | **absent** | ❌ **blocked** |
| `FACE_LEGAL_APPROVAL_VERSION` | `face-rollout.ts:161,24` | one member of the allowlist | yes | **Counsel — the approved version (§3 gap)** | **absent** | ❌ **blocked** |
| `FACE_EMERGENCY_DISABLE` | `face-rollout.ts:132,168` | unset / not `"1"` (kill switch OFF) | yes (set→off) | Ops (must be unset to activate) | example only | ✅ safe (leave unset) |

**Gate math** (`faceMatchLegalGate()`, `face-rollout.ts:158`; enforced in prod only at
`face-match-providers.ts:322`): `isFaceMatchConfigured()` is `false` in production while
**any** of `FACE_LEGAL_APPROVED_VERSIONS`, `FACE_LEGAL_APPROVAL_VERSION` (∈ allowlist),
`FACE_AWS_DPA_CONFIRMED=1`, `FACE_CALIBRATION_APPROVED=1`, `FACE_CALIBRATION_VERSION`,
kill-switch-off is unmet → the start endpoint returns `503 provider_unavailable` (correct, by design).

---

## 4. Legal version identifiers (Phase B) + governance gap

| Item | Value / status | Source |
|---|---|---|
| `BIOMETRIC_CONSENT_VERSION` | **`2026-07-bio-v1`** | `src/lib/services/face-verification.ts:46` |
| Biometric Information Policy (L5.1) | version `1.0`, **draft**, `effectiveDate` empty, `consentVersion: 2026-07-bio-v1` | `docs/L5.1-…md` frontmatter |
| Photo Verification Policy (L5.2) | version `1.0`, **draft** | `docs/L5.2-…md` |
| Identity Verification Policy (L5.3) | version `1.0`, **draft** | `docs/L5.3-…md` |
| Data Retention Policy (L4.1) | version `1.0`, **draft** (biometric retention pending DPIA) | `docs/L4.1-…md` |
| Privacy Policy (L2.3) | draft (referenced) | `docs/L2.3-…md` |

**Synchronization:** the code consent version (`2026-07-bio-v1`) and the L5.1 policy
frontmatter agree. All policies sit at `1.0` **draft**, `lastUpdated 2026-07-17`,
**none published** (empty `effectiveDate`).

> **GOVERNANCE GAP (must resolve before setting either legal var):** the repository
> does **not** define whether `FACE_LEGAL_APPROVAL_VERSION` is meant to **equal**
> `BIOMETRIC_CONSENT_VERSION` (`2026-07-bio-v1`) or a **separate** legal-approval-package
> identifier. Counsel + engineering must decide and record this. **Do not choose a
> value arbitrarily.** Recommended resolution: define one canonical mapping in
> `docs/L1-LEGAL-ARCHITECTURE.md` (e.g. "the approval version is the consent version
> counsel signed") and add a test pinning `FACE_LEGAL_APPROVAL_VERSION ∈ FACE_LEGAL_APPROVED_VERSIONS`.

---

## 5. AWS DPA evidence checklist (Phase C) → `FACE_AWS_DPA_CONFIRMED=1`

Set the flag **only** when every row is satisfied and stored:

- [ ] AWS Data Processing Addendum executed or incorporated (AWS DPA + GDPR terms).
- [ ] Contracting entity named: **WiseWave Limited** (CRO 762171).
- [ ] AWS account/entity covered (the production Rekognition account) recorded.
- [ ] Scope: region `eu-west-1`, service **Rekognition** (Face Liveness + Collections).
- [ ] Subprocessors reviewed and listed (DPIA §6: AWS; confirm no further subprocessors).
- [ ] International-transfer mechanism confirmed (target: EU-only; SCCs/adequacy if any transfer).
- [ ] Retention/deletion responsibilities aligned with L4.1 + `DeleteFaces` teardown path.
- [ ] Approval owner + date recorded.
- [ ] Document storage location recorded (contract vault / DPA register).

**Repository sufficiency:** ❌ **Insufficient.** DPIA §6 marks the AWS DPA "pending §13".
No executed DPA is in the repo. **Leave `FACE_AWS_DPA_CONFIRMED` unset.**

---

## 6. Calibration approval package (Phase D) → `FACE_CALIBRATION_APPROVED=1` + `FACE_CALIBRATION_VERSION`

The tooling exists (`docs/CALIBRATION.md`, `face:calibrate`) but **recommends only** —
it never approves. A formal, immutable report must exist containing:

- [ ] Dataset scope (size, label source, positive/negative pairs).
- [ ] **Lawful source** of test data (consented / synthetic / licensed — not production users without basis).
- [ ] Demographic coverage (age, skin tone, gender presentation) + fairness analysis.
- [ ] Device coverage (iOS/Android, front cameras, resolutions).
- [ ] **FAR / FRR** results at the chosen operating point.
- [ ] Lighting + movement condition coverage.
- [ ] Threshold values (`FACE_MATCH_THRESHOLD`, `FACE_MISMATCH_THRESHOLD`, `FACE_MANUAL_REVIEW_MIN`).
- [ ] Comparison methodology (SearchFacesByImage banding, not raw scores to users).
- [ ] Retry policy (fresh session per attempt — matches implementation).
- [ ] Manual-review / escalation behaviour for the uncertain band.
- [ ] Known limitations.
- [ ] Approval owner + approval date.
- [ ] Immutable report version → becomes `FACE_CALIBRATION_VERSION` (e.g. `cal-2026-07-v1`).

> Unit tests are **not** calibration approval. `tests/face-calibrate.test.ts` proves the
> tooling, not the model's real-world FAR/FRR.

**Repository sufficiency:** ❌ **No approved package.** `docs/FACE-CALIBRATION.md` status
is **"pending"**. **Leave both calibration vars unset.** The checklist above is the
required report structure to produce.

---

## 7. Vercel Production procedure (Phase G)

1. Confirm §2 approvals + §4 gap resolved; attach source documents to the change record.
2. In **Vercel → Project → Settings → Environment Variables → Production** (Production
   scope only — never Preview), set the §3 variables from their approval sources.
   Keep AWS secrets out of git; they live only in Vercel.
3. Trigger the **canonical CI deployment** (merge/deploy `main` at `17a698d` or a descendant).
   Do **not** hand-deploy.
4. Confirm the deployed commit includes **`17a698d`**: `git log --oneline | grep 17a698d`
   and match Vercel's deployed SHA.
5. Confirm the migration gate passes (release gate / migration governance — see recent
   release commits `5a7a0e0`, `002b1d5`).
6. As an authenticated eligible user, `POST /api/verification/liveness` and confirm:
   it **no longer** returns `provider_unavailable`; returns **200**; body has a **non-empty
   fresh `flowId`**; no `photoVerifiedAt` (Stripe) prerequisite reappears; a
   `ProfilePhotoVerification` row now exists and is **consent-stamped** (`consentVersion=2026-07-bio-v1`).
7. Confirm the flowId binds a fresh `LivenessSession` (owner + environment + `expiresAt`).
8. Run the §10 physical-device test.
9. Record evidence (§10).
10. If any acceptance criterion fails → roll back (§8) or trip the kill switch (§9).

---

## 8. Rollback procedure

Ordered by blast radius (from `docs/FACE-EMERGENCY-ROLLBACK.md`):

- **Tier 1 — Kill switch (seconds):** set `FACE_EMERGENCY_DISABLE=1` → gate fails closed,
  layer dormant, config preserved.
- **Tier 2 — Dormancy:** unset `FACE_MATCH_PROVIDER` (or a legal var) → `isFaceMatchConfigured()=false`.
- **Tier 3 — Vendor purge:** admin `DeleteFaces` / collection purge (biometric removal).
- **Tier 4 — Code revert:** revert the deploy; inert tables/columns remain safe & dormant.
- **Partial:** lower `FACE_VERIFICATION_PERCENT`.

Rollback must **not** delete users, mark anyone verified, or leave secrets in git.

---

## 9. Emergency kill-switch procedure

`FACE_EMERGENCY_DISABLE=1` in Vercel Production → redeploy/propagate → verify the start
endpoint returns `503 provider_unavailable` and no new sessions are created. This overrides
every other gate (allowlist, cohort, recovery). Leave **unset** to activate.

---

## 10. Physical-device acceptance test (Phase E/H)

**This is the only step that can produce PASS.** Run on real hardware over HTTPS.

**Prerequisites:** disposable eligible account (registered, no Stripe); camera-capable
iPhone Safari (+ Android Chrome if available); camera permission resettable.

**Sequence (per device):**
1. Sign in as the eligible non-Stripe user.
2. Profile → Photo verification → **Verify**.
3. Confirm the consent card renders (opaque-reference wording; `2026-07-bio-v1`).
4. Tap **Agree & start**. Verify: start request → **200**; **AWS Face Liveness UI visibly opens**;
   camera permission prompted; **live camera preview** visible; AWS oval/instructions render;
   **no instant fallback card**.
5. **Deliberate failed capture:** verify the camera **did** run, and **only then** the
   lighting/movement copy appears; **retry creates a different fresh flowId/session**; camera reopens.
6. **Valid capture:** verify server retrieves the result via `GetFaceLivenessSessionResults`
   (server-side); ownership + freshness checks pass; canonical state → **verified**; badge
   activation runs **only** through the canonical resolver; **no client-supplied PASS trusted**.

**Evidence to collect:** redacted network log; redacted server/CloudWatch log; screenshot/video
of the real AWS camera UI; sessionId/flowId **hashed or partially redacted**; DB state-transition
evidence **without** biometric material.
**Redact:** AWS creds, `sessionId`, session tokens, full `flowId`, any face image/frame/URL.
**Cleanup:** withdraw consent + delete the test account → `DeleteFaces` destroys the vendor
reference; confirm no biometric material remains.

---

## 11. Sign-off table

| Role | Approves | Name | Date | Artifact ref |
|---|---|---|---|---|
| Privacy Counsel / DPO | L5.1 + DPIA §13; sets legal version | | | |
| Legal / Commercial | AWS DPA executed | | | |
| Data Science + Approver | Calibration report + version | | | |
| Engineering | Env vars, deploy of `17a698d`, gate math | | | |
| Trust & Safety | Consent copy accuracy, review flow | | | |
| Ops | Vercel prod set, kill-switch tested | | | |

---

## 12. Final GO / NO-GO

**GO only when:** all §11 rows signed; §2 three approvals exist; §4 gap resolved;
`FACE_LEGAL_APPROVED_VERSIONS`, `FACE_LEGAL_APPROVAL_VERSION`, `FACE_AWS_DPA_CONFIRMED=1`,
`FACE_CALIBRATION_APPROVED=1`, `FACE_CALIBRATION_VERSION` set in Vercel Production from their
sources; kill switch unset; deployed SHA ⊇ `17a698d`; migration gate green; and the §10
physical-device test PASSED on at least iPhone Safari.

**Current: NO-GO →** `BLOCKED — LEGAL` (DPIA/L5.1 unapproved, no executed DPA, legal-version
gap) **and** `BLOCKED — CALIBRATION` (no approved package/version). Operations (Vercel/AWS/device)
are downstream and not yet reachable.

---

## Appendix — AWS operator verification (Phase F)

Exact scopes are documented in `docs/AWS-IAM-VERIFICATION.md`. Verify (do **not** modify IAM
unless authorized):

- **Server principal can call `CreateFaceLivenessSession`** — runtime creds
  (`AWS_ACCESS_KEY_ID`/`SECRET`) policy allows `rekognition:StartFaceLivenessSession` +
  `GetFaceLivenessSessionResults` + scoped collection ops, region-pinned `eu-west-1`.
  *(Verified live from code path: real `sessionId` returned.)*
- **Runtime `sts:AssumeRole` is single-role-scoped** — only the configured
  `FACE_LIVENESS_ROLE_ARN`. `aws iam get-role-policy` / list the runtime user's policy.
- **Browser role allows only `StartFaceLivenessSession`** — `TirveaFaceLivenessStreaming`
  policy has exactly that action, `aws:RequestedRegion == eu-west-1`. No IndexFaces/SearchFaces/DeleteFaces.
  *(Verified live: STS AssumeRole returns short-lived `ASIA…` creds.)*
- **`GetFaceLivenessSessionResults` is server-only** — never in the browser role; result
  consumption is `flowId`-bound server-side (`consumeLivenessFlow`).
- **Trust policy** on the streaming role permits only the intended runtime principal — inspect `aws iam get-role`.
- **CloudTrail/CloudWatch** record `CreateFaceLivenessSession` / `AssumeRole` — confirm in the eu-west-1 trail.
- **Region** is `eu-west-1` and equals the collection region.
- **No wildcards** exceed the map in `docs/AWS-IAM-VERIFICATION.md` (`Action`/`Resource` scoped, no `*`).

Live AWS reachability (server primitives) is already proven; **this appendix is for the
operator to confirm the deployed IAM policy JSON matches**, which requires AWS-account access.
