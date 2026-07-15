# DPIA Working Document — Photo (Face) Verification

Status: **WORKING DRAFT — NOT APPROVED.** This is the implementation-side
input to a Data Protection Impact Assessment. It does not constitute
legal approval. Production biometric processing stays blocked
(`FACE_LEGAL_APPROVAL_VERSION` unset) until counsel signs the checklist
in §13. Do not fabricate approval.

## 1. Processing overview

Optional feature confirming a member's profile photos depict the member,
via a consented video-selfie liveness capture (EU-processed) that yields
a vendor-side face reference, against which profile photos are compared.
Special-category (biometric) data, GDPR Art. 9.

## 2. Data-flow diagram

```
member ──consent──> capture (video selfie, provider SDK, EU)
                       │  video + frames held briefly by provider, then deleted
                       ▼
                 liveness result ──pass──> reference frame ──IndexFaces──> vendor Collection (EU)
                       │                                                      │ opaque FaceId
                       ▼                                                      ▼
                 Tirvea stores: opaque referenceId, result, reason codes   (NO geometry/images at Tirvea)
                       ▼
                 profile photos ──SearchFacesByImage──> normalized band ──> decision + badge
                       ▼
                 optional: SearchFaces (duplicate likeness) ── flagged ──> human review
                       ▼
   deletion: account teardown / withdraw consent ──DeleteFaces──> reference destroyed at vendor
```

## 3. Lawful basis (placeholder — counsel to confirm)

Intended: explicit consent, Art. 9(2)(a), versioned
(`BIOMETRIC_CONSENT_VERSION`), separate from ToS, withdrawable. Art. 6
basis: consent / legitimate interests for fraud prevention (to be
confirmed).

## 4. Necessity & proportionality

Necessity: identity verification (document) cannot bind a member's
gallery to them; catfishing with stolen photos is a primary dating-safety
harm this specifically addresses. Proportionality: opaque references (no
geometry at Tirvea), coarse bands not raw scores, liveness minimises
false accepts, TTL + rotation, human review of every adverse automatic
outcome, feature is optional.

## 5. Data minimisation assessment

No biometric vectors stored at Tirvea (schema-pinned test). No images,
scores, vendor ids, signed URLs or payloads in logs, analytics, alerts,
admin UI, support view, client responses or URLs (test-pinned). Capture
media held briefly by the provider only.

## 6. Processors & subprocessors

- Stripe (identity verification — separate, existing DPA).
- Face-comparison provider (AWS Rekognition, eu-west-1 — DPA pending §13).
- [PLACEHOLDER] confirm no further subprocessors; list to accompany the DPA.

## 7. International-transfer analysis

Target: EU-only processing (eu-west-1), enforced in the adapter
(`AWS_ALLOWED_REGIONS`). [PLACEHOLDER] confirm no US control-plane
transfer for Rekognition; transfer mechanism (SCCs) in the AWS DPA.

## 8. Retention schedule (placeholder)

| Data                           | Retention                         | Mechanism                                                 |
| ------------------------------ | --------------------------------- | --------------------------------------------------------- |
| Video / capture frames         | minimal (provider)                | provider config `AuditImagesLimit: 0`; provider lifecycle |
| Face reference (vendor)        | while verification valid; rotated | `FACE_REFERENCE_TTL_DAYS`, lifecycle sweep                |
| Result / reason codes (Tirvea) | account lifetime                  | teardown cascade                                          |
| Audit events                   | account lifetime                  | teardown cascade                                          |

[PLACEHOLDER] final numbers pending sign-off.

## 9. Deletion-verification procedure

1. Trigger: account teardown OR Settings → delete face data OR admin
   request-new-selfie (rotation).
2. `deleteReference()` / `rotateReference()` → provider `DeleteFaces`.
3. Row cascade removes the local pointer + result rows.
4. `face_data_deleted` / `face_reference_rotated` audit event recorded.
5. Verification evidence (this phase, mock provider): the chaos +
   security suites assert reference severance and audit emission; against
   the real provider a `DeleteFaces` returns success and a subsequent
   `SearchFaces` no longer returns the FaceId (to be captured at staging).

## 10. Data-subject rights workflow

Access/portability: support view (states/dates/reasons — no biometrics).
Erasure: as §9. Rectification/restriction/objection: appeal machine +
manual review. Contact dpo@tirvea.com; supervisory authority: Irish DPC.

## 11. Incident-notification workflow

Provider breach / credential leak / wrongful-suspension incidents:
runbooks in FACE-VERIFICATION-RUNBOOK.md (detection → containment →
recovery → postmortem). Art. 33/34 assessment and 72h notification are a
[PLACEHOLDER] to be added to the incident runbook by the DPO.

## 12. AWS DPA completion checklist

- [ ] AWS DPA executed with GDPR terms.
- [ ] Rekognition biometric-processing terms confirmed for EU/IE/UK.
- [ ] Region pinned to eu-west-1; no cross-region replication.
- [ ] Subprocessor list obtained and recorded (§6).
- [ ] Data-deletion SLA confirmed and matched to §8.

## 13. Legal-review sign-off checklist (GATES production)

- [ ] Lawful basis confirmed (§3).
- [ ] Consent copy + notices approved (/legal/biometric-data,
      /safety/face-check, /help/photo-verification).
- [ ] Retention periods finalised (§8) and reflected in the notices.
- [ ] International-transfer mechanism confirmed (§7).
- [ ] Duplicate-likeness search scope + lawful basis approved (or feature
      left disabled: `FACE_DUPLICATE_SEARCH_ENABLED=0`).
- [ ] Auto-suspension approved (or left disabled:
      `FACE_AUTO_SUSPEND_ENABLED=0`).
- [ ] DPIA signed; `FACE_LEGAL_APPROVAL_VERSION` set to the sign-off id.

Until every box is checked, the layer stays dormant by construction.
