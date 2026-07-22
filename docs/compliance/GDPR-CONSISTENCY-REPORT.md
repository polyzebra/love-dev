# GDPR Consistency Report (L9.0)

| | |
|---|---|
| Document Version | 1.0 |
| Status | Draft |
| Prepared By | WiseWave Limited |
| Last Updated | 2026-07-21 |
| Effective Date | Pending Approval |
| Approved By | Pending |

Each GDPR data-subject right and processing principle, verified against the **actual
implementation** (code file:line). Verdicts: IMPLEMENTED / PARTIAL / NOT FOUND.
Controller: **WiseWave Limited**; supervisory authority: Irish DPC; contact: info@tirvea.com.

> **L9.1 UPDATE (2026-07-21):** Item 2 (Right to erasure) is now **IMPLEMENTED**. The
> self-service deletion completion gap is closed by `cleanupExpiredDeletions()` (daily
> auth-cleanup cron → `teardownAccount` + GoTrue identity delete after the 30-day grace),
> proven by `tests/account-deletion-sweep.test.ts`. GDPR posture: **no remaining gaps**;
> the accuracy notes in §3 are wording refinements for the legal-review pass.

## 1. Rights & principles → implementation

| # | GDPR item | Verdict | Code evidence | Note |
|---|---|---|---|---|
| 1 | Access / portability (Art. 15/20) | **IMPLEMENTED** | `src/app/api/account/export/route.ts:8-61` | `GET /api/account/export`; session-scoped JSON export (account, profile, photos, likes, matches, messages, payments); no biometrics. |
| 2 | Erasure (Art. 17) + biometric DeleteFaces | **PARTIAL** | `src/app/api/account/delete/route.ts:11-44`; `src/lib/auth/identity.ts:73-135`; `face-verification.ts:886-890` → `DeleteFaces` | Teardown is complete but invoked **only** by the Supabase auth-deletion webhook. Self-service delete tombstones + sets `deletionRequested`; **no cron completes it** → see Gap **G2**. |
| 3 | Rectification (Art. 16) | **IMPLEMENTED** | `src/app/api/profile/route.ts:20` (PATCH); `src/app/api/me/settings/route.ts:18` | Profile/prompts + settings edits. |
| 4 | Restriction / objection (Art. 18/21) | **IMPLEMENTED** | consent withdraw `verification/consent/withdraw/route.ts:15-27`; marketing opt-outs `settings.ts:15-22`; profile hide `account/delete/route.ts:29-32` | No single "pause all processing" switch; expressed via withdrawal + opt-outs + hide. |
| 5 | Consent management (versioned + timestamped) | **IMPLEMENTED** | biometric `face-verification.ts:46,278-288,429,852-853`; legal `auth/consent.ts:15-92` | Versioned + timestamped; withdrawal clears version + drops reference. |
| 6 | Automated decisions (Art. 22) + human review | **IMPLEMENTED** | manual review `face-verification.ts:150`; staff `admin/face-checks/[id]/action/route.ts:26`; appeals `services/appeals.ts` | Auto-verify only on confident match; ambiguous → human; adverse → appealable. |
| 7 | Storage limitation / retention sweeps | **IMPLEMENTED** | face TTL `face-reference-registry.ts:113,124`; sweep `face-reference.ts:104-145` via `cron/face-checks:35`; auth cleanup `auth/cleanup.ts` | Only missing sweep: the account 30-day deletion window (G2). |
| 8 | Security measures | **IMPLEMENTED** | rate-limit `rate-limit.ts:212-229`; webhook HMAC `webhook-signatures.ts:16-48`; private bucket + signed URLs `media.ts:20,125`; cron bearer secret | Encryption-at-rest inherited from managed Supabase/AWS (not asserted in app code). |
| 9 | Audit logging / accountability | **IMPLEMENTED** | `VerificationAuditEvent` schema `1761-1778`; writer `face-verification.ts:195-224`; `audit.ts` (AdminLog) | Event/reason/metadata only — no biometric bytes. |
| 10 | International transfers (EU pinning) | **IMPLEMENTED** | `aws-rekognition.ts:48,57-58,174-183,439-453`; region persisted `face-reference-registry.ts:122` | Hard-pinned eu-west-1, fail-closed. |
| 11 | Children / minimum age | **IMPLEMENTED** | `auth/age-confirm/route.ts:14-31`; gate `auth/consent.ts:28-61` | Self-attested **18+ gate** (attestation, not DOB/document verification) — describe accurately as a *gate*. |
| 12 | Incident response / alerting | **IMPLEMENTED** | `provider-resilience.ts:269` (raiseOpsAlert), circuit breaker `:93-126`; runbooks `G7-INCIDENT-RESPONSE.md`, `FACE-ALERTING.md` | Alerts carry error name only, never PII. Art. 33/34 72h workflow: DPO to formalize (DPIA §11). |

## 2. GDPR gaps

- **G2 (item 2) — the one real gap.** Self-service erasure does not auto-complete
  (no cron on `deletionRequested`). This is both a documentation inconsistency (the
  code comment + policies promise a sweep that does not exist) **and** a substantive
  Art. 17 risk. Remediation in `LEGAL-GAP-REPORT.md` G2.

## 3. Accuracy notes (not gaps, reflect in the policies)

- Age (item 11): a **self-attested 18+ gate**, not identity/DOB age *verification*.
  Child Safety + Terms should say "gate," not "verification."
- Encryption at rest (item 8) is **inherited from managed infrastructure**; the
  Security Policy should state this rather than imply app-level at-rest encryption.
- Restriction (item 4) has no single global switch; the GDPR Rights Policy should
  describe the actual levers (consent withdrawal, marketing opt-out, profile hide).

## 4. Verdict

Data-subject rights and principles are **substantively implemented in code** — the
documentation set is well-supported by the implementation, with **one erasure-completion
gap (G2)** to reconcile and three wording accuracy notes above. GDPR posture is
**not a blanket blocker**, but **G2 must be resolved** and the age/encryption/restriction
wording aligned before publication.
