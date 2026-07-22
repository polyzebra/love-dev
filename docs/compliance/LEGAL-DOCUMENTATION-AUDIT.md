# Legal Documentation Audit (L9.0)

| | |
|---|---|
| Document Version | 1.0 |
| Status | Draft |
| Prepared By | WiseWave Limited |
| Last Updated | 2026-07-21 |
| Effective Date | Pending Approval |
| Approved By | Pending |

Scope: every legal / privacy / compliance / trust document in `docs/`, cross-checked
against the canonical slug map (`src/lib/legal/loader.ts`) and the implementation.
This audit **does not approve** anything; all documents remain **Draft** pending counsel.

## 1. Metadata standard (Phase H)

Published policies use loader-bound frontmatter (`title, slug, version, status,
effectiveDate, lastUpdated, owner`) — **all 24 already carry all seven fields**
(Phase E of the cross-ref audit). The loader validates required fields, so the
existing schema is retained rather than replaced. The Phase H labels map as:
Document Version→`version` (1.0), Status→`status` (draft), Last Updated→`lastUpdated`,
Effective Date→`effectiveDate` (empty = "Pending Approval"), Prepared By = WiseWave
Limited (entity, per L1), Approved By = Pending (no doc is Approved). **No frontmatter
schema was mutated in this task** (mutating it risks breaking the loader validation).

## 2. Published policy inventory (slug-mapped, L2.2–L7.5)

All: Version **1.0**, Status **draft**, Effective Date **empty (Pending Approval)**,
Approved By **Pending**. Purpose = as titled. Completeness = complete draft unless noted.

| File | Slug | Title | Owner | Last Updated | Notes / gaps |
|---|---|---|---|---|---|
| L2.2-TERMS-OF-SERVICE-DRAFT.md | terms | Terms of Service | Legal Counsel | 2026-07-17 | Incorporates `/legal/copyright` (**broken — missing doc**) |
| L2.3-PRIVACY-POLICY-DRAFT.md | privacy | Privacy Policy | Privacy Counsel/DPO | 2026-07-17 | DPO contact = info@; "Confirm DPO" open item |
| L2.4-COOKIE-POLICY-DRAFT.md | cookies | Cookie Policy | Privacy Counsel/DPO | 2026-07-17 | — |
| L2.5-COMMUNITY-GUIDELINES-DRAFT.md | community-guidelines | Community Guidelines | T&S Lead | 2026-07-17 | refs `/legal/copyright` |
| L2.6-ACCEPTABLE-USE-POLICY-DRAFT.md | acceptable-use | Acceptable Use Policy | T&S/Security | 2026-07-17 | refs `/legal/copyright` |
| L3.1-TRUST-AND-SAFETY-POLICY-DRAFT.md | trust-safety | Trust & Safety Policy | T&S Lead | 2026-07-17 | refs `/legal/copyright` |
| L3.2-APPEALS-POLICY-DRAFT.md | appeals | Appeals Policy | T&S Lead | 2026-07-17 | — |
| L3.3-ACCOUNT-SUSPENSION-POLICY-DRAFT.md | account-suspension | Account Suspension Policy | T&S Lead | 2026-07-17 | — |
| L3.4-CHILD-SAFETY-POLICY-DRAFT.md | child-safety | Child Safety Policy | T&S Lead | 2026-07-17 | Age = self-attested 18+ gate |
| L3.5-AI-MODERATION-POLICY-DRAFT.md | ai-moderation | AI Moderation Policy | T&S Lead | 2026-07-17 | — |
| L4.1-DATA-RETENTION-POLICY-DRAFT.md | data-retention | Data Retention Policy | Privacy Counsel/DPO | 2026-07-17 | **Timeline conflict w/ L4.3** (§gap) |
| L4.2-GDPR-RIGHTS-POLICY-DRAFT.md | gdpr | GDPR & Your Rights | Privacy Counsel/DPO | 2026-07-17 | — |
| L4.3-ACCOUNT-DELETION-POLICY-DRAFT.md | account-deletion | Account Deletion Policy | Privacy Counsel/DPO | 2026-07-17 | **Erasure completion gap** (§gap) |
| L4.4-COOKIE-PREFERENCES-POLICY-DRAFT.md | cookie-preferences | Cookie Preferences | Privacy Counsel/DPO | 2026-07-17 | — |
| L5.1-BIOMETRIC-INFORMATION-POLICY-DRAFT.md | biometric-data | Biometric Information Policy | Privacy+T&S | 2026-07-17 | consentVersion `2026-07-bio-v1` ✓ |
| L5.2-PHOTO-VERIFICATION-POLICY-DRAFT.md | photo-verification | Photo Verification Policy | Privacy+T&S | 2026-07-17 | Manual-review wording accurate ✓ |
| L5.3-IDENTITY-VERIFICATION-POLICY-DRAFT.md | identity-verification | Identity Verification Policy | Privacy+T&S | 2026-07-17 | — |
| L6.1-SUBSCRIPTION-TERMS-DRAFT.md | subscription-terms | Subscription Terms | Legal Counsel | 2026-07-17 | — |
| L6.2-REFUND-POLICY-DRAFT.md | refund-policy | Refund Policy | Legal Counsel | 2026-07-18 | "WiseWave" → normalize to "WiseWave Limited" |
| L7.1-SECURITY-POLICY-DRAFT.md | security | Security Policy | Security Lead | 2026-07-18 | — |
| L7.2-VULNERABILITY-DISCLOSURE-POLICY-DRAFT.md | vulnerability-disclosure | Vulnerability Disclosure | Security Lead | 2026-07-18 | security@ flagged as unused placeholder |
| L7.3-LAW-ENFORCEMENT-GUIDELINES-DRAFT.md | law-enforcement | Law Enforcement Guidelines | Legal Counsel | 2026-07-18 | — |
| L7.4-TRANSPARENCY-REPORT-POLICY-DRAFT.md | transparency | Transparency Report | Legal Counsel | 2026-07-18 | — |
| L7.5-COMPLIANCE-STATEMENT-DRAFT.md | compliance | Compliance Statement | Legal Counsel | 2026-07-18 | — |

**Missing published document:** **Copyright Policy** (`/legal/copyright`) — referenced
as incorporated/live in 6 docs but **no master file exists** and the slug is **not in
the loader map**. See gap report G1.

## 3. Internal / architecture / compliance docs (not slug-published)

| File | Purpose | Frontmatter | Status |
|---|---|---|---|
| L1-LEGAL-ARCHITECTURE.md | Master blueprint (entity, slugs, versions) | none (internal) | living |
| L3-L7-IMPLEMENTATION-ROADMAP.md | Roadmap | none | living |
| LEGAL-STYLE-STANDARD.md | Drafting conventions | none | living |
| DPIA-FACE-VERIFICATION.md | **DPIA (completed draft — this task)** | metadata header added | Draft, not approved |
| CALIBRATION.md / FACE-CALIBRATION.md | Calibration tooling + guide | none | pending |
| FACE-CALIBRATION-DRAFT.md | **Calibration report draft (this task)** | metadata header | Draft, pending measurements |
| AWS-IAM-VERIFICATION.md | IAM least-privilege reference | none | reference |
| operations/FACE-LIVENESS-PRODUCTION-ACTIVATION.md | Activation runbook (L8.3.7) | header | reference |

## 4. Completeness summary

- **24/24** published policies are complete drafts with full metadata; **0** are Approved (correct — counsel-gated).
- **1 missing document** (Copyright Policy).
- **DPIA**: completed to a full working draft in this task (was missing risk matrix / residual / alternatives / conclusion — now added).
- **Calibration**: report structure drafted; real measurements Pending.
- Detailed findings: see `LEGAL-GAP-REPORT.md`, `GDPR-CONSISTENCY-REPORT.md`, `BIOMETRIC-COMPLIANCE-REPORT.md`.
