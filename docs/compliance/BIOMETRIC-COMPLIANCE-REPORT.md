# Biometric Compliance Report (L9.0)

| | |
|---|---|
| Document Version | 1.0 |
| Status | Draft |
| Prepared By | WiseWave Limited |
| Last Updated | 2026-07-21 |
| Effective Date | Pending Approval |
| Approved By | Pending |

Consistency of the biometric documentation set (Biometric Information Policy L5.1,
Photo Verification Policy L5.2, Identity Verification Policy L5.3, DPIA) against the
**enforced implementation**. Special-category data (GDPR Art. 9). Provider: **AWS
Rekognition** (incl. **AWS Face Liveness**), eu-west-1.

> **L9.1 UPDATE (2026-07-21):** G7 resolved — `schema.prisma` `referenceId`/
> `identitySessionId` comments corrected to the liveness-only origin (the accurate
> `STRIPE_SELFIE_COMPARE` binding-method enum was intentionally left intact). Biometric
> deletion on account erasure is now enforced end-to-end (the 30-day deletion cron calls
> `teardownAccount` → `DeleteFaces`; see GDPR report). Activation remains **BLOCKED —
> LEGAL + CALIBRATION** (compliance approvals, unchanged from L8.3.7).

## 1. Claim-by-claim verification (implementation wins)

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | No biometric templates/vectors/geometry at Tirvea — only an opaque `referenceId` | **CONSISTENT** | `schema.prisma:1600-1601,1671-1674`; tests `face-verification.test.ts:570-575`, `face-security.test.ts:469` |
| 2 | Capture video/frames held only by AWS; never **stored** by Tirvea | **CONSISTENT** (see note) | `face-liveness.ts:222-288`; `aws-rekognition.ts:285-294,407-409` (`AuditImagesLimit: 0`) |
| 3 | AWS stores the reference in an EU collection via IndexFaces | **CONSISTENT** | `aws-rekognition.ts:291-302,48,51` |
| 4 | Comparison via SearchFacesByImage/DetectFaces; coarse bands, not raw scores | **CONSISTENT** | `aws-rekognition.ts:321-358`; `face-outcomes.ts:25-26`; `verification-support.ts:13-14` |
| 5 | Versioned biometric consent, separate from ToS, before processing, withdrawable | **CONSISTENT** | `face-verification.ts:46`; `liveness/route.ts:38,72-75`; `face-liveness.ts:120-127`; `consent/withdraw` → `:834` |
| 6 | Withdrawal OR deletion destroys the vendor reference (DeleteFaces) | **CONSISTENT** | `face-verification.ts:846,889-903`; `face-reference-registry.ts:157-193` → `aws-rekognition.ts:394-402` |
| 7 | Adverse automatic outcomes → human manual review | **DOC CORRECTED** | Ambiguous → manual review; **confident** adverse → auto-decided + appealable (`face-verification.ts:341-368,734-742,364-365`) |
| 8 | Badge revoked on photo fail or consent withdrawal | **CONSISTENT** | `face-verification.ts:684-688,793,864`; schema `:383-391` |
| 9 | Reference only from a passed liveness; never an unverified profile photo | **CONSISTENT (code); stale schema comment** | `aws-rekognition.ts:278-311`; `face-liveness.ts:152-174` — but `schema.prisma:1672,1681` comments stale (G7) |
| 10 | Liveness pass/fail decided server-side; no client PASS trusted | **CONSISTENT** | `aws-rekognition.ts:415-426`; `face-liveness.ts:93-161` |
| 11 | EU region pinned + enforced in adapter | **CONSISTENT** | `aws-rekognition.ts:58,443-454`; `aws-sts.ts:33` |
| 12 | Reference TTL / rotation | **CONSISTENT** | `face-verification.ts:73`; `face-reference.ts:103-154`; schema `:1636-1643` |

Note (Claim 2): precise for the capture *stream* (browser→AWS). The single liveness
reference frame transits the server **in-memory** for IndexFaces and is **never
stored**. Prefer "never **stored** by Tirvea servers" in the notices (Gap G10).

## 2. Required corrections to the biometric docs

1. **Manual-review wording (G4).** Any doc claiming "every adverse outcome is
   human-reviewed" must be reworded to: *ambiguous* outcomes → human manual review;
   *confident* adverse outcomes → automatically decided and **appealable**. (DPIA §4
   already corrected; L5.2 wording was already accurate; verify L5.1.)
2. **Stale schema comments (G7).** `schema.prisma:1672,1681` describe a "Stripe
   identity selfie" origin that no longer matches the liveness-only path. Correct the
   comments (engineering; comment-only) so the paper trail matches enforced code.
3. **Claim-2 exactness (G10).** Use "never stored by Tirvea servers."

## 3. Consistency across the biometric set

- Consent version `2026-07-bio-v1` is consistent across L1, L5.1, and the DPIA, and
  matches the code constant `BIOMETRIC_CONSENT_VERSION`.
- Provider naming ("AWS Rekognition" / "AWS Face Liveness"; "Stripe Identity" for
  document identity) is consistent across the set (cross-ref audit §D).
- Ownership boundaries are clean: L5.1 owns biometric handling; L5.2 references it;
  L5.3 covers document identity separately.

## 4. Production activation status (from L8.3.7)

Biometric processing stays **dormant by construction** until the runtime legal gate
(`faceMatchLegalGate()`) is satisfied. The three missing gate values —
`FACE_LEGAL_APPROVED_VERSIONS`, `FACE_LEGAL_APPROVAL_VERSION`, `FACE_CALIBRATION_VERSION`
— are **compliance approvals, not config**, and depend on: counsel sign-off of L5.1 +
DPIA, an executed AWS DPA, and an approved calibration package (`FACE-CALIBRATION-DRAFT.md`).
Full runbook: `docs/operations/FACE-LIVENESS-PRODUCTION-ACTIVATION.md`.

## 5. Verdict

The biometric **implementation** is strong and matches the documentation on 11 of 12
claims; the 12th (manual review) is a documentation overstatement now corrected in the
DPIA. Remaining biometric-doc actions: G4 (verify L5.1 wording), G7 (schema comments),
G10 (exactness). **Activation remains BLOCKED — LEGAL + CALIBRATION** (unchanged from L8.3.7).
