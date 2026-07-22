# Legal Gap Report (L9.0)

| | |
|---|---|
| Document Version | 1.0 |
| Status | Draft |
| Prepared By | WiseWave Limited |
| Last Updated | 2026-07-21 |
| Effective Date | Pending Approval |
| Approved By | Pending |

Every gap found across the documentation, implementation-consistency, GDPR, and
cross-reference audits. Severity: **P0** = blocks legal review / go-live; **P1** =
must fix before publication; **P2** = normalize/cleanup. "Impl wins" = the code is
correct and the document must be rewritten to match it.

## P0 — Blockers

| ID | Gap | Evidence | Owner | Remediation |
|---|---|---|---|---|
| **G1** | **Copyright Policy missing.** `/legal/copyright` is referenced as incorporated/live in 6 docs (Terms L2.2, Community L2.5, Acceptable Use L2.6, Trust & Safety L3.1, roadmap, L1) and self-certified as "resolves," but **no master file exists** and the slug is **absent from the loader map** (`src/lib/legal/loader.ts`). `registry.ts` lists it, so registry.ts and loader.ts **disagree**. | Cross-ref audit §A | Legal Counsel + Eng | Draft the Copyright/DMCA Policy (notice-and-takedown, agent contact, counter-notice); register the slug in `loader.ts` + `doc-slugs.ts`; reconcile `registry.ts`. Until then the self-certification tables in L2.2/L2.6/L3.1 are **incorrect**. |
| **G2** | **GDPR erasure completion gap (Art. 17).** Self-service `POST /api/account/delete` only tombstones the account + sets `deletionRequested`, and its comment + the policies promise a "30-day scheduled hard delete." **No cron consumes `deletionRequested`**; the real `teardownAccount` (which triggers biometric `DeleteFaces`) is wired **only** to the Supabase auth-deletion webhook. A user-initiated deletion not mirrored by a GoTrue deletion may never hard-delete. | GDPR audit item 2; `src/app/api/account/delete/route.ts:8-9`; `vercel.json` crons | Eng + Privacy Counsel | Either (a) add a cron consuming `deletionRequested` → `teardownAccount` after the grace window, **or** (b) trigger the Supabase admin user-deletion from the self-service endpoint. Until fixed, correct the code comment + L4.3/L4.1 wording to not promise an automatic sweep. **Impl must change OR docs must stop over-promising** — this is a real erasure risk, not cosmetic. |

## P1 — Fix before publication

| ID | Gap | Evidence | Owner | Remediation |
|---|---|---|---|---|
| **G3** | **DPIA incomplete** (was missing risk matrix, residual risk, alternatives, security controls, conclusion, approval placeholders). | DPIA pre-audit | Eng (done) + DPO (approve) | **Resolved in this task** — `docs/DPIA-FACE-VERIFICATION.md` completed to a full working draft. DPO to review + sign §13/§18. |
| **G4** | **DPIA overstated manual review** — "human review of every adverse automatic outcome." Code auto-decides *confident* adverse outcomes (→ appeals), reserving manual review for *ambiguous* cases. **Impl wins.** | Consistency audit #7; `face-verification.ts:341-368,734-742` | Eng (done) | **Resolved** — DPIA §4 reworded to match code. |
| **G5** | **DPIA wrong contact** — `dpo@tirvea.com` (appears nowhere else) contradicts the info@tirvea.com contact model in the Privacy Policy. | Cross-ref §C; `DPIA…:96` (old), `L2.3…:162` | Eng (done) + Privacy | **Resolved** — DPIA now uses info@tirvea.com. If a dedicated DPO mailbox is later provisioned, add it consistently across all docs. |
| **G6** | **Account-deletion timeline conflict.** L4.1 says erasure "within 30 days of deletion"; L4.3 says "grace window + 30 days" (~up to 60 days from request). | Cross-ref §G; `L4.1…:56,162`; `L4.3…:56,152,164` | Privacy Counsel | Reconcile in L4.1 (canonical owner of retention): state the grace-window-plus-30 model explicitly; make L4.3 reference it. Tie to G2's actual mechanism. |
| **G7** | **Stale schema comments (paper-trail).** `prisma/schema.prisma:1672,1681` still describe the face reference as derived from the "Stripe identity selfie"; enum value `STRIPE_SELFIE_COMPARE:1913`. Code is strictly **liveness-only** (`createReference` throws; only `createReferenceFromLiveness` mints a FaceId). | Consistency audit #9 | Eng | Correct the two comment lines to describe the liveness-only reference (comment-only, no migration). The enum *value* name is a DB type — leave unless a migration is planned. **Not changed in this docs task** (flagged for engineering). |

## P2 — Normalize / cleanup

| ID | Gap | Evidence | Owner | Remediation |
|---|---|---|---|---|
| **G8** | **Entity name shorthand** — Refund Policy uses bare "WiseWave" in several sentences; elsewhere "WiseWave Limited". | Cross-ref §B; `L6.2…:46,95,100,129,236` | Legal Counsel | Normalize to the full legal name "WiseWave Limited". |
| **G9** | **Placeholder external URL** — `https://status.tirvea.com` referenced in L1 as operator-hosted; likely not yet live. | Cross-ref §F; `L1…:103` | Ops | Provision the status page or mark the reference as "planned" until live. |
| **G10** | **Claim-2 exactness** — "never pass through Tirvea servers" is precise for the capture *stream* but the single reference frame transits the server in-memory (never stored). | Consistency audit #2 caveat | Privacy/Eng | Where docs assert this, prefer "never **stored** by Tirvea servers." |
| **G11** | **security@tirvea.com** appears in L7.2 but is explicitly flagged there as an unused old placeholder (reporting routes to info@). | Cross-ref §C | Security Lead | No action required unless the mailbox is provisioned; keep the explicit note. |

## Notes on scope

- P0/P1 items G1, G2, G6, G7 that touch **source legal drafts or code** were **not
  auto-edited** in this task (they need counsel/engineering judgement); they are
  precisely specified above. The DPIA (a named deliverable) **was** completed and
  corrected (G3–G5) because it is this task's output.
- No application behaviour was changed. No document was marked Approved.
