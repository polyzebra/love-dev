# Production Readiness Review — Verification Stack (Phase 20)

Stance: independent. Previous decisions are challenged on their merits;
several of this system's own choices are flagged as debt below.

## Architecture review

Sound: two-layer separation (identity vs profile photos) with one
canonical verdict per concern; every subsystem reuses an existing
machine (appeals->violations, health->ProviderHealth, queue->job rows +
cron, audit->append-only events). Provider independence is enforced by
tests, not convention.

**Challenged decisions:**

1. **Queue-as-table + cron sweep is a throughput ceiling.** 10 jobs/10min
   = ~1.4k recovery runs/day. The PRIMARY path (after()) is unbounded,
   so this only caps recovery from failures - but a provider outage at
   scale (100k queued) would take weeks to drain at sweep pace.
   _Verdict: fine for launch; raise sweep batch via env and move to a
   real worker (QStash/SQS) past ~50k verified users._ (TD-1)
2. **Admin queue computes risk per row server-side** - computeTrustProfile
   is a multi-query aggregate; 20 rows = ~100 queries per page load.
   Tolerable for an internal page at current queue sizes; wasteful.
   _Verdict: accept now; snapshot the band onto the job row at run time
   later._ (TD-3)
3. **Risk double-counting** (security audit M-3): face rejections feed
   the composite twice (violation via trust-engine + face signal).
   Direction is safe (over-review, never over-grant) but calibration
   will chase a phantom. _Verdict: real defect of THIS build's design;
   config-fixable; must be addressed during threshold calibration._ (TD-2)
4. **Dead enum values.** `TWIN_RISK` and `LOW_CONFIDENCE` exist in the
   schema and docs, but the classifier never emits TWIN_RISK (it folds
   into LIKELY_DUPLICATE) and LOW_CONFIDENCE only as an aggregation
   floor. Unnecessary surface that reads as capability we don't have.
   _Verdict: either wire demographic-conflict evidence for TWIN_RISK or
   trim the claims in docs; keep enum values (migration-cheap)._ (TD-4)
5. **SELF_RESTORE rarely fires as designed.** It keys on matching
   email/phone - but account teardown ANONYMISES both, so a genuinely
   returning user usually classifies LIKELY_DUPLICATE -> manual review.
   Not unsafe, but adds review load and contradicts the classifier's
   intent. _Verdict: hidden risk worth fixing - persist a salted hash of
   the pre-teardown phone for restore matching, or accept the review
   cost knowingly._ (R-2 in risk register)
6. **Metrics band derivation is crude** - `riskLevel * 10` through
   bandFromScore reuses a knob for a purpose it wasn't calibrated for.
   _Verdict: cosmetic-analytics only; annotate or store real bands._ (TD-5)
7. **after() reliability** is best-effort on serverless. Accepted
   deliberately: cron recovery + dead-letter bound the damage; worst
   case is 10-minute latency, not loss. _Verdict: correct trade._
8. **Dashboards are one endpoint + doc groupings, not four UIs.** The
   spec asked for four dashboards; building four admin pages now would
   be premature. _Verdict: honest scope cut, documented; revisit with a
   real BI tool._ (TD-6)

## Security review

See SECURITY-AUDIT-VERIFICATION.md: 0 open Critical/High in code,
4 Medium, 4 Low, 10 Resolved-and-pinned. The standing Criticals (real
provider, DPIA) are process items gating the face layer only.

## Operations review

Runbooks cover the 11 required incidents with detection/impact/response/
recovery/postmortem. Alerting exists but rides the in-app notification
outbox (M-4) - adequate for a single-operator team, below enterprise bar
for on-call. Circuit breaker, backoff, retries, dead-letter: implemented
and chaos-tested. BC/DR documented with RTO/RPO; the strongest property
is that verification is OFF the critical product path - total provider
loss degrades to manual review, never blocks the app.

## Compliance review

- GDPR art. 9 explicit consent: modelled (versioned), copy pending
  counsel review. DPIA: NOT DONE (Critical C-2). Vendor DPA: NOT DONE.
- Data minimisation: strong - no biometrics at Tirvea, opaque
  references, vendor-side deletion, TTL + rotation, anonymous analytics.
- Data subject rights: deletion (teardown) and appeal (existing machine)
  paths implemented and tested; export path exists via support view.
- Retention: reference TTL 365d default; liveness frames <=24h (planned
  S3 lifecycle - to be verified at provider implementation).

## Scores (1-10)

| Dimension             | Score | Note                                                                  |
| --------------------- | ----- | --------------------------------------------------------------------- |
| Architecture          | 8.5   | reuse discipline high; TD-1..4 known                                  |
| Security              | 8     | no open code findings; M-1/M-2 operational                            |
| Privacy               | 9     | minimisation by construction, test-pinned                             |
| Scalability           | 7     | per-user paths fine; recovery sweep + admin N+1 ceilings known        |
| Availability          | 8.5   | degrades gracefully; off critical path                                |
| Observability         | 7.5   | metrics + alerts real; no external pager/BI                           |
| Maintainability       | 8     | pure policy fns, seams everywhere; face-verification.ts growing large |
| Provider independence | 9     | adapter-enforced by tests                                             |
| Compliance            | 5     | DPIA/DPA outstanding - the gating dimension                           |
| Documentation         | 9     | threat model, runbooks, BC/DR, audits                                 |
| Testing               | 9     | 48 suites; policy/lifecycle/chaos/privacy pinned                      |
| Operations            | 8     | runbooks + alerts; single-channel alerting                            |

**Production Readiness Score: 8.0 / 10** (weighted; compliance caps it).

## Technical debt register

| ID   | Item                                         | Sev | Owner action                                                  |
| ---- | -------------------------------------------- | --- | ------------------------------------------------------------- |
| TD-1 | Cron sweep throughput ceiling                | Med | env batch raise now; worker queue past ~50k verified users    |
| TD-2 | Risk double-count (face violations)          | Med | calibrate weights / exclude face violations from trust signal |
| TD-3 | Admin queue risk N+1                         | Low | snapshot band on job row                                      |
| TD-4 | Dead enum values (TWIN_RISK, LOW_CONFIDENCE) | Low | wire or trim claims                                           |
| TD-5 | Metrics band derivation hack                 | Low | store real bands                                              |
| TD-6 | Dashboards = endpoint + docs, not UIs        | Low | BI tool when team grows                                       |
| TD-7 | `isFinalRejection` reviewNote convention     | Low | column when second writer lands                               |
| TD-8 | face-verification.ts size (~800 lines)       | Low | split run/apply/admin when next touched                       |

## Risk register

| ID  | Risk                                                                 | Likelihood | Impact | Mitigation                                                                   |
| --- | -------------------------------------------------------------------- | ---------- | ------ | ---------------------------------------------------------------------------- |
| R-1 | Deepfake injection on web liveness                                   | Med        | High   | vendor PAD certification at selection; native attestation in Capacitor phase |
| R-2 | Returning users misclassified LIKELY_DUPLICATE (anonymised teardown) | High       | Low    | manual review absorbs; hashed-identity restore matching later                |
| R-3 | Threshold miscalibration at launch                                   | Med        | Med    | staged rollout + FP alert + emergency disable                                |
| R-4 | Single-operator alerting gap (M-4)                                   | Med        | Med    | external alert channel before enabling the layer                             |
| R-5 | Laptop compromise = production secrets (M-1)                         | Low        | High   | secret manager migration                                                     |
| R-6 | Prisma CLI unusable against prod DB (hangs)                          | High       | Low    | documented runtime-client DDL procedure; consider session-pooler URL for CLI |

## Go / No-Go

- **Identity verification (Stripe) - GO** (already live): document +
  selfie verification, session reuse, reconciliation, appeals, health
  recording, runbooks - all operational and tested in production.
- **Profile-photo (face) layer - NO-GO** until, in order:
  1. C-1: real provider adapter implemented + calibrated
     (FACE-REFERENCE-AUDIT §8 plan);
  2. C-2: DPIA executed + vendor DPA signed + consent copy counsel-approved;
  3. M-3/TD-2: risk weights calibrated with double-count resolved;
  4. M-4/R-4: one external alert channel live.
     Until then `FACE_MATCH_PROVIDER` stays unset in production - the
     dormant layer is inert by construction (chaos-tested).

No Critical item may be waived; this document is the checklist of record.
