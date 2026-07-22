# DPIA — Photo (Face) Verification

| | |
|---|---|
| Document Version | 1.0 |
| Status | **Draft (completed working draft) — NOT APPROVED** |
| Prepared By | WiseWave Limited (engineering + Trust & Safety input) |
| Last Updated | 2026-07-21 |
| Effective Date | Pending Approval |
| Approved By | Pending (Privacy Counsel / DPO) |

> **This is the completed implementation-side working draft of the Data Protection
> Impact Assessment.** It does not constitute legal approval. Production biometric
> processing stays blocked (`FACE_LEGAL_APPROVAL_VERSION` unset; see
> `docs/operations/FACE-LIVENESS-PRODUCTION-ACTIVATION.md`) until counsel signs
> §13. Every measurement or legal determination that requires counsel/DPO is
> marked **[Pending]**. Do not fabricate approval, values, or test results.

Controller / contracting entity: **WiseWave Limited** (CRO 762171, 39 Cooley Park,
Dundalk, Co. Louth, A91 AP2V, Ireland). Brand: Tirvea. Supervisory authority: Irish DPC.
Contact point: **info@tirvea.com**.

## 1. Processing overview

Optional feature confirming a member's profile photos depict the member, via a
consented video-selfie liveness capture (EU-processed) that yields a vendor-side
face reference, against which profile photos are compared. Special-category
(biometric) data, GDPR Art. 9.

## 2. Data-flow diagram

```
member ──consent──> capture (video selfie, provider SDK, EU)
                       │  video + frames held briefly by provider, then deleted
                       ▼
                 liveness result ──pass──> reference frame ──IndexFaces──> vendor Collection (EU)
                       │                                                      │ opaque FaceId
                       ▼                                                      ▼
                 Tirvea stores: opaque referenceId, result, reason codes   (NO geometry/images stored at Tirvea)
                       ▼
                 profile photos ──SearchFacesByImage──> normalized band ──> decision + badge
                       ▼
                 optional: SearchFaces (duplicate likeness) ── flagged ──> human review
                       ▼
   deletion: account teardown / withdraw consent ──DeleteFaces──> reference destroyed at vendor
```

Verified against implementation (L9.0 audit): the capture stream is browser→AWS;
only an opaque `flowId` reaches the client; the single liveness reference frame
transits the server **in memory** for `IndexFaces` and is **never stored**
(`aws-rekognition.ts` `AuditImagesLimit: 0`). Tirvea persists only the opaque
vendor `referenceId`, coarse bands, and reason codes.

## 3. Lawful basis (counsel to confirm)

Intended: explicit consent, Art. 9(2)(a), versioned (`BIOMETRIC_CONSENT_VERSION` =
`2026-07-bio-v1`), separate from ToS, withdrawable. Art. 6 basis: consent /
legitimate interests for fraud prevention. **[Pending counsel confirmation.]**

## 4. Necessity & proportionality

Necessity: document identity verification cannot bind a member's gallery to them;
catfishing with stolen photos is a primary dating-safety harm this specifically
addresses. Proportionality: opaque references (no geometry at Tirvea), coarse bands
not raw scores, liveness minimises false accepts, TTL + rotation, human review of
**ambiguous** outcomes, and the feature is optional.

> **Implementation-accurate note (L9.0 correction).** Not every adverse outcome is
> human-reviewed. **Ambiguous** cases (flagged/uncertain cover, multiple faces,
> low confidence, or a critical composite-risk band) are routed to human
> **manual review**. **Confident** adverse outcomes (a confident different-person
> cover, or an aggregate other-person pattern) are **automatically decided**
> (badge suspended/withheld) and are **appealable** through the appeals process —
> they are not silently final, but they are not manually pre-reviewed either.
> This matches `src/lib/services/face-verification.ts` (decision + appeals paths).

## 5. Data minimisation assessment

No biometric vectors, templates, or geometry stored at Tirvea (schema-pinned test).
No images, raw scores, vendor ids, signed URLs, or payloads in logs, analytics,
alerts, admin UI, support view, client responses, or URLs (test-pinned). Capture
media held briefly by the provider only. Internal similarity scores are retained
for tuning; only a coarse band and the boolean badge are ever surfaced.

## 6. Processors & subprocessors

- Stripe (identity verification — separate, existing DPA).
- Face-comparison provider: **AWS Rekognition** (incl. AWS Face Liveness), eu-west-1
  — **AWS DPA [Pending] (§12).**
- **[Pending]** confirm no further subprocessors; list to accompany the AWS DPA.

## 7. International-transfer analysis

Target: EU-only processing (eu-west-1), enforced in the adapter
(`AWS_ALLOWED_REGIONS`, fail-closed region guard). **[Pending]** confirm no US
control-plane transfer for Rekognition; transfer mechanism (SCCs) recorded in the
AWS DPA.

## 8. Retention schedule

| Data | Retention | Mechanism |
|---|---|---|
| Video / capture frames | minimal (provider) | provider `AuditImagesLimit: 0`; provider lifecycle |
| Face reference (vendor) | while verification valid; rotated | `FACE_REFERENCE_TTL_DAYS` (default 365), lifecycle sweep |
| Result / reason codes (Tirvea) | account lifetime | teardown cascade |
| Audit events | account lifetime | teardown cascade |

**[Pending]** final numbers confirmed by counsel and reflected in the notices +
L4.1 Data Retention Policy.

## 9. Deletion-verification procedure

1. Trigger: account teardown OR Settings → delete face data OR admin request-new-selfie (rotation).
2. `deleteAllUserReferences()` / `rotateReference()` → provider `DeleteFaces`.
3. Row cascade removes the local pointer + result rows; DELETE_PENDING retry sweep covers vendor outages.
4. `face_data_deleted` / `face_reference_rotated` audit event recorded.
5. Evidence (mock provider): chaos + security suites assert reference severance and
   audit emission. Against the real provider, `DeleteFaces` returns success and a
   subsequent `SearchFaces` no longer returns the FaceId — **[to be captured at staging]**.

> **Cross-reference to the account-deletion gap (L9.0).** The *biometric* deletion
> path above is complete and is invoked by `teardownAccount`. However, the
> **self-service** account-deletion endpoint currently only tombstones the account
> and sets `deletionRequested`; `teardownAccount` is invoked by the Supabase
> auth-deletion webhook, and **no cron consumes `deletionRequested`**. See the
> GDPR gap report — the erasure-completion mechanism must be reconciled (engineering)
> before the deletion timelines in L4.1/L4.3 can be relied upon.

## 10. Data-subject rights workflow

Access/portability: `GET /api/account/export` (account+profile+photos+likes+matches+
messages+payments; no biometrics). Erasure: as §9 + the account-deletion reconciliation.
Rectification: profile/settings `PATCH`. Restriction/objection: consent withdrawal +
marketing opt-outs + profile hide. Contact **info@tirvea.com**; supervisory authority: Irish DPC.

## 11. Incident-notification workflow

Provider breach / credential leak / wrongful-suspension incidents: runbooks in
`docs/FACE-VERIFICATION-RUNBOOK.md` and `docs/G7-INCIDENT-RESPONSE.md`
(detection → containment → recovery → postmortem); coded alerting/escalation in
`provider-resilience.ts` (alerts carry error name only, never PII). Art. 33/34
assessment and 72h notification: **[Pending]** DPO to add to the incident runbook.

## 12. AWS DPA completion checklist

- [ ] AWS DPA executed with GDPR terms (contracting entity: WiseWave Limited).
- [ ] Rekognition biometric-processing terms confirmed for EU/IE/UK.
- [ ] Region pinned to eu-west-1; no cross-region replication.
- [ ] Subprocessor list obtained and recorded (§6).
- [ ] Data-deletion SLA confirmed and matched to §8.

## 13. Legal-review sign-off checklist (GATES production)

- [ ] Lawful basis confirmed (§3).
- [ ] Consent copy + notices approved (/legal/biometric-data, /safety/face-check, /help/photo-verification).
- [ ] Retention periods finalised (§8) and reflected in notices + L4.1.
- [ ] International-transfer mechanism confirmed (§7).
- [ ] Duplicate-likeness search scope + lawful basis approved (or left disabled: `FACE_DUPLICATE_SEARCH_ENABLED=0`).
- [ ] Auto-suspension approved (or left disabled: `FACE_AUTO_SUSPEND_ENABLED=0`).
- [ ] Account-deletion erasure-completion reconciled (§9 gap).
- [ ] DPIA signed; `FACE_LEGAL_APPROVAL_VERSION` set to the sign-off id (∈ `FACE_LEGAL_APPROVED_VERSIONS`).

Until every box is checked, the layer stays dormant by construction.

## 14. Risk assessment (likelihood × impact → mitigation → residual)

Scale: L/M/H. "Residual" is the risk *after* the listed mitigation, assuming the
mitigation is live in production.

| # | Risk | Likelihood | Impact | Mitigation (implemented unless marked) | Residual |
|---|---|---|---|---|---|
| R1 | Biometric template/geometry leak from Tirvea | Low | High | Tirvea stores no template/geometry — only opaque `referenceId` (schema-pinned test) | **Low** |
| R2 | Capture media exfiltration | Low | High | Stream is browser→AWS; frame transits server in-memory only, never stored; `AuditImagesLimit: 0` | **Low** |
| R3 | Processing outside the EU | Low | High | Region hard-pinned eu-west-1, fail-closed adapter guard; region snapshotted on record | **Low** |
| R4 | Unauthorised use of a session/flow | Low | Medium | Opaque `flowId`; ownership + environment + freshness binding; server-side result; no client PASS trusted | **Low** |
| R5 | False accept (someone verifies as another) | Medium | High | Liveness gate; calibrated thresholds **[calibration Pending]**; manual review of ambiguous cases | **Medium [Pending calibration]** |
| R6 | False reject / demographic bias | Medium | Medium | Manual review + appeals; calibration must include demographic coverage **[Pending calibration]** | **Medium [Pending calibration]** |
| R7 | Processing without valid consent | Low | High | Versioned consent captured before processing; re-checked at run + consume; withdrawal drops reference | **Low** |
| R8 | Data not deleted on withdrawal/erasure | Medium | High | Biometric `DeleteFaces` path complete; **BUT** self-service account-deletion completion gap (§9) | **Medium — until §9 reconciled** |
| R9 | Automated decision without recourse (Art. 22) | Low | Medium | Confident adverse → appealable; ambiguous → human review; staff decision path | **Low** |
| R10 | Over-collection / scope creep (duplicate search, auto-suspend) | Low | Medium | Both gated behind flags, disabled by default pending approval | **Low** |
| R11 | Vendor (AWS) breach | Low | High | AWS DPA **[Pending]**; opaque reference only; deletion SLA to be confirmed | **[Pending DPA]** |

## 15. Security controls

Encryption in transit: HTTPS/TLS everywhere; AWS calls over SigV4/TLS. Encryption at
rest: inherited from managed Supabase/AWS infrastructure (not asserted in app code).
Access control: session-scoped endpoints; RBAC (`verifications:review`) on staff
decisions; private photo bucket + short-lived signed URLs. Secrets: server-only; STS
mints short-lived least-privileged browser creds (StartFaceLivenessSession only);
cron bearer secrets fail-closed. Rate limiting: fail-closed `guardRate` on
consent/liveness/sensitive endpoints. Logging: `VerificationAuditEvent` records
event/reason/metadata only — no biometric bytes.

## 16. Alternatives considered

1. **Document-only identity verification (Stripe Identity alone).** Rejected as
   insufficient: it binds a *document* to a person but cannot confirm the *profile
   gallery* belongs to that person — the exact catfishing harm.
2. **Manual human photo review only.** Rejected at scale: slower, less consistent,
   exposes reviewers to more personal imagery than an automated coarse-band check.
3. **On-device / no-vendor matching.** Not currently feasible with the required
   liveness assurance; would still process biometrics. Revisit if a compliant
   on-device option matures.
4. **Store templates at Tirvea.** Rejected: maximises breach impact. Chosen design
   stores no template — only an opaque vendor handle.

Chosen approach is the least-data option that meets the safety need, with the
feature optional and consented.

## 17. Conclusion & residual-risk statement

With the mitigations in §14 live, most risks are **Low**. Two residual risks remain
**Medium and are gated**: (R5/R6) match accuracy and bias — blocked behind the
**[Pending] calibration** package; and (R8) erasure completion for self-service
deletion — blocked behind an engineering reconciliation. Vendor-breach residual
(R11) is **[Pending]** the AWS DPA. **Conclusion: processing must NOT go live until
(a) counsel signs §13, (b) the AWS DPA is executed, (c) a calibration package is
approved, and (d) the account-deletion erasure gap is reconciled.** The runtime gate
(`faceMatchLegalGate()`) enforces (a)–(c) fail-closed.

## 18. Approval placeholders

| Role | Decision | Name | Date | Signature/ref |
|---|---|---|---|---|
| Privacy Counsel / DPO | Approve DPIA + lawful basis; set `FACE_LEGAL_APPROVAL_VERSION` | | | |
| Legal / Commercial | Confirm AWS DPA executed | | | |
| Data Science + Approver | Approve calibration package + version | | | |
| Trust & Safety | Confirm consent copy + review flow | | | |
| Engineering | Confirm implementation matches this DPIA; reconcile §9 erasure gap | | | |

**No one may change Status from Draft to Approved except the authorised approver.**
