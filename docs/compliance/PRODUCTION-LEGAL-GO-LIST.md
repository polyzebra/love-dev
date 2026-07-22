# Production Legal GO-List (L9.0)

| | |
|---|---|
| Document Version | 1.0 |
| Status | Draft |
| Prepared By | WiseWave Limited |
| Last Updated | 2026-07-21 |
| Effective Date | Pending Approval |
| Approved By | Pending |

Single GO/NO-GO view for publishing the legal documentation set and (separately)
activating Face Liveness. **This document does not grant approval.** No document is Approved.

## 1. GO / NO-GO — Legal documentation publication

| # | Criterion | State |
|---|---|---|
| 1 | All required policies exist as complete drafts | ❌ **Copyright Policy missing (G1)** |
| 2 | No broken cross-references | ❌ `/legal/copyright` broken in 6 docs (G1) |
| 3 | Implementation-consistent (impl wins) | ⚠️ G4/G5 fixed (DPIA); **G2 erasure** + G7 comments open |
| 4 | GDPR rights implemented | ✅ 11/12; ❌ erasure completion (G2) |
| 5 | Metadata consistent | ✅ 24/24 published policies |
| 6 | Entity / contact / provider naming consistent | ⚠️ G8 (WiseWave Limited), G5 fixed |
| 7 | Deletion timeline reconciled | ❌ G6 (L4.1 vs L4.3) |
| 8 | Counsel review complete + Status→Approved | ❌ Pending (all Draft, by design) |

**Documentation verdict: NO-GO.** Blocking: **G1** (missing Copyright Policy +
broken incorporations) and **G2** (erasure completion). G6 must be reconciled. G7/G8/G9/G10
are pre-publication cleanups. Then the full set goes to counsel for Draft→Approved.

## 2. GO / NO-GO — Face Liveness activation (separate track, from L8.3.7)

| # | Criterion | State |
|---|---|---|
| 1 | L5.1 Biometric Policy + DPIA counsel-approved | ❌ Draft |
| 2 | AWS DPA executed (`FACE_AWS_DPA_CONFIRMED=1`) | ❌ Pending |
| 3 | Calibration approved (`FACE_CALIBRATION_APPROVED=1` + version) | ❌ Pending (real measurements needed) |
| 4 | Legal version identifiers set + governance gap resolved | ❌ Pending |
| 5 | Code path deployed (`17a698d`+) | ⏳ Operator deploy |
| 6 | Physical-device acceptance test PASS | ❌ Not run |

**Activation verdict: NO-GO — BLOCKED (LEGAL + CALIBRATION).** Unchanged from L8.3.7.

## 3. Ordered path to GO

1. **Draft the Copyright Policy** + register slug (`loader.ts`/`doc-slugs.ts`), reconcile `registry.ts` → clears **G1**.
2. **Reconcile erasure** (add `deletionRequested` cron OR trigger auth deletion) and correct L4.3/L4.1 + the code comment → clears **G2**.
3. Reconcile the deletion **timeline** in L4.1 (canonical) → clears **G6**.
4. Apply cleanups **G7** (schema comments), **G8** (entity name), **G9** (status URL), **G10** (wording), plus age/encryption/restriction accuracy notes.
5. Counsel reviews the full set → authorised approver sets **Status: Approved** + Effective Date per document.
6. **Separately**, for Face Liveness: sign L5.1 + DPIA, execute the AWS DPA, approve a real calibration report, resolve the version-identifier gap, deploy, and run the physical-device test (`docs/operations/FACE-LIVENESS-PRODUCTION-ACTIVATION.md`).

## 4. What this task delivered

- Completed the **DPIA** to a full working draft (risk matrix, residual, alternatives, conclusion, approvals) and fixed two consistency defects (manual-review wording, DPO contact).
- Drafted the **Calibration Report** structure (measurements Pending).
- Produced the audit, gap, GDPR, and biometric reports + this go-list + the approval checklist/governance matrix.
- **No document marked Approved. No application logic changed.**
