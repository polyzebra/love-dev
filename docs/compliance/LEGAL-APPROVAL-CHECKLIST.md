# Legal Approval Checklist & Governance Matrix (L9.0)

| | |
|---|---|
| Document Version | 1.0 |
| Status | Draft |
| Prepared By | WiseWave Limited |
| Last Updated | 2026-07-21 |
| Effective Date | Pending Approval |
| Approved By | Pending |

> Only qualified legal counsel or the company's authorised approver may change a
> document's Status from **Draft** to **Approved** and assign an Effective Date.
> This checklist prepares that review; it does not perform it.

## 1. Per-document sign-off checklist

For each published policy: [ ] counsel reviewed  ·  [ ] cross-refs resolve  ·
[ ] implementation-consistent  ·  [ ] Status→Approved + Effective Date set (authorised approver only).

| Document | Reviewer | Blockers before approval |
|---|---|---|
| L2.2 Terms of Service | Legal Counsel | **G1** (copyright incorporation broken) |
| L2.3 Privacy Policy | Privacy Counsel/DPO | Confirm DPO contact model (info@) |
| L2.4 Cookie Policy | Privacy Counsel/DPO | — |
| L2.5 Community Guidelines | T&S Lead | G1 |
| L2.6 Acceptable Use | T&S/Security | G1 |
| L3.1 Trust & Safety | T&S Lead | G1 |
| L3.2 Appeals | T&S Lead | — |
| L3.3 Account Suspension | T&S Lead | — |
| L3.4 Child Safety | T&S Lead | Age = "gate" not "verification" |
| L3.5 AI Moderation | T&S Lead | — |
| L4.1 Data Retention | Privacy Counsel/DPO | **G6** timeline; **G2** erasure mechanism |
| L4.2 GDPR & Your Rights | Privacy Counsel/DPO | Restriction levers wording |
| L4.3 Account Deletion | Privacy Counsel/DPO | **G2** erasure completion; **G6** timeline |
| L4.4 Cookie Preferences | Privacy Counsel/DPO | — |
| L5.1 Biometric Information | Privacy + T&S + biometric counsel | DPIA sign-off; G4 wording check |
| L5.2 Photo Verification | Privacy + T&S | — |
| L5.3 Identity Verification | Privacy + T&S | — |
| L6.1 Subscription Terms | Legal Counsel | — |
| L6.2 Refund Policy | Legal Counsel | **G8** entity name |
| L7.1 Security Policy | Security Lead | Encryption-at-rest wording |
| L7.2 Vulnerability Disclosure | Security Lead | — |
| L7.3 Law Enforcement | Legal Counsel | — |
| L7.4 Transparency Report | Legal Counsel | — |
| L7.5 Compliance Statement | Legal Counsel | — |
| **Copyright Policy (MISSING)** | Legal Counsel | **G1 — must be drafted + registered** |
| DPIA (this task) | Privacy Counsel/DPO | Sign §13/§18 |
| Calibration Report (draft) | Data Science + approver | Real measurements (§3–§6) |

## 2. Governance matrix (Phase J)

| Document | Owner | Reviewer | Approval required | Dependencies | Production blocker? | Required before Face Liveness activation? |
|---|---|---|---|---|---|---|
| Terms of Service | Legal Counsel | Counsel | Yes | Copyright, Privacy | No | No |
| Privacy Policy | Privacy Counsel/DPO | Counsel/DPO | Yes | Retention, GDPR, Biometric | No | Indirect |
| Data Retention | Privacy Counsel/DPO | DPO | Yes | Deletion, Biometric | No | Indirect |
| Account Deletion | Privacy Counsel/DPO | DPO | Yes | Retention, **G2 eng fix** | **Yes (G2)** | No |
| GDPR & Your Rights | Privacy Counsel/DPO | DPO | Yes | all rights | No | No |
| Child Safety | T&S Lead | Counsel | Yes | — | No | No |
| **Biometric Information (L5.1)** | Privacy + T&S | **Biometric counsel + DPO** | **Yes** | **DPIA, calibration, DPA** | **Yes** | **YES** |
| Photo Verification (L5.2) | Privacy + T&S | Counsel | Yes | L5.1 | No | **YES** |
| Identity Verification (L5.3) | Privacy + T&S | Counsel | Yes | — | No | No |
| **DPIA** | Eng + DPO | **DPO / Privacy Counsel** | **Yes (signature)** | calibration, DPA, G2 | **Yes** | **YES** |
| **Calibration Report** | Data Science | **Approver (T&S/Eng lead)** | **Yes** | real test data | **Yes** | **YES** |
| AWS DPA (external) | Legal/Commercial | Counsel | Yes (execution) | AWS | **Yes** | **YES** |
| **Copyright Policy (missing)** | Legal Counsel | Counsel | Yes (after drafting) | — | **Yes (G1)** | No |
| Security / Vuln / Law Enf / Transparency / Compliance | respective | Counsel | Yes | — | No | No |

## 3. Face Liveness activation gate summary (from L8.3.7)

| Gate value | Depends on | Status |
|---|---|---|
| `FACE_LEGAL_APPROVED_VERSIONS` + `FACE_LEGAL_APPROVAL_VERSION` | L5.1 + DPIA counsel sign-off; resolve version-identifier governance gap | ❌ Pending |
| `FACE_AWS_DPA_CONFIRMED=1` | Executed AWS DPA | ❌ Pending |
| `FACE_CALIBRATION_APPROVED=1` + `FACE_CALIBRATION_VERSION` | Approved calibration report (real measurements) | ❌ Pending |
| `FACE_EMERGENCY_DISABLE` off | Ops | ✅ (leave unset) |

Runbook: `docs/operations/FACE-LIVENESS-PRODUCTION-ACTIVATION.md`.
