# G7 — Incident Response (Face Verification & Platform)

Consolidated incident-response reference. It **builds on** the existing docs —
do not duplicate them:
- **Rollback tiers + decision tree:** `FACE-EMERGENCY-ROLLBACK.md`
- **Per-incident runbooks (Detect→Impact→Respond→Recover→Postmortem) + BC/DR + RTO/RPO:** `FACE-VERIFICATION-RUNBOOK.md` §Incident response / §Business continuity
- **Alert rules + response:** `FACE-ALERTING.md`, `G6-MONITORING-RUNBOOK.md`
- **Privacy/GDPR:** `DPIA-FACE-VERIFICATION.md`
- **Threat model / security audit:** `THREAT-MODEL-VERIFICATION.md`, `SECURITY-AUDIT-VERIFICATION.md`

This doc adds: the **P0–P3 classification**, the **AWS/Stripe/security sub-playbooks** not already explicit, the **communications plan**, and the **postmortem template**.

---

## 1. Incident classification (P0–P3)

| Level | Definition | Examples | Max response | Max resolution target | Escalation | Comms |
|---|---|---|---|---|---|---|
| **P0** | Security breach or platform-down; user harm or data risk | AWS/Stripe secret exposed; biometric compromise; DB leak; admin compromise; false-negative wave (impersonators verified); auth down | **15 min** ack | 4 h contain / 24 h resolve | on-call → eng lead → CTO → (Security/DPO for data) | status page + internal war-room + (regulator if personal data) |
| **P1** | Major degradation, no breach | Provider `UNAVAILABLE` (AWS/Stripe), verification queue stalled, dead-letter growth, false-positive wave (legit users suspended) | **30 min** ack | 8 h | on-call → eng lead → T&S if trust-impacting | internal + status page if user-visible |
| **P2** | Partial/elevated but self-healing | Provider `DEGRADED`, manual-review spike, duplicate/appeal spike, elevated retries | **2 h** ack | 2 business days | on-call → owning team | internal |
| **P3** | Low impact / cosmetic / follow-up | Alert noise, single-user edge case, minor config drift | **1 business day** | next sprint | ticket | none |

Map alerts → severity: `provider_down` & provider-config(region/emergency) = **P0/P1**; `queue_stalled`, `face_dead_letter`, `suspension_spike`, `false_positive_spike`, `provider_degraded` = **P1/P2**; `manual_review_spike`, `verification_spike`, `appeal_spike` = **P2** (see `G6-MONITORING-RUNBOOK.md` severity table).

---

## 2. Emergency controls (verified, env-driven — see FACE-EMERGENCY-ROLLBACK.md)

| Control | Action | Effect | Verified |
|---|---|---|---|
| **Kill switch** | `FACE_EMERGENCY_DISABLE=1` | halts admission + in-flight processing + enrollment (enforced in 6 services) | ✅ code + `face-emergency-disable` test |
| Stop rollout | `FACE_VERIFICATION_PERCENT=0` | no new cohort admissions | ✅ |
| Disable enrollment | kill switch or unset provider | no new references minted | ✅ |
| Rollback provider | unset `FACE_MATCH_PROVIDER` | layer dormant; badge = identity-only | ✅ |
| Rollback calibration | re-pin `FACE_CALIBRATION_VERSION` + values | reproducible (stamped on decisions) | ✅ |
| Rollback threshold | re-pin `FACE_THRESHOLD_VERSION` + values | prior calibration restored | ✅ |
| Rollback deployment | redeploy prior build (additive migrations) | code revert | ✅ |
| Read-only mode | unset provider + `percent=0` | verification inert; browsing/matching/chat unaffected (not on critical path) | ✅ |

All levers are Vercel-env changes (± redeploy) → **immediate**. Fail-closed everywhere: AWS/Stripe outage never fabricates a match.

---

## 3. AWS incident playbooks

Generic AWS/face-provider outage, credential leak, queue/dead-letter, region loss, vendor migration → **FACE-VERIFICATION-RUNBOOK.md**. Sub-playbooks:

- **STS / AssumeRole failure:** *Detect* CloudWatch AssumeRole error alarm; liveness streaming creds fail. *Contain* liveness capture fails closed per attempt (no enrollment); browsing unaffected. *Recover* verify the trust policy/role (G2), re-issue on retry. *If persistent* kill switch.
- **Rekognition unavailable / throttling:** *Detect* `provider_down`/`provider_degraded`; CloudWatch `ThrottlingException`. *Contain* circuit breaker opens → jobs park `QUEUED`, nothing granted. *Recover* breaker half-opens after cooldown; cron drains; raise sweep `take` if backlog. *If throttled* request a Rekognition quota increase.
- **Wrong region / region mismatch:** *Detect* provider-config alert (`assertRegionConsistency` fails closed — layer refuses). *Contain* automatic (fail closed). *Recover* fix `AWS_REGION`/`AWS_REKOGNITION_REGION` to agree + be in `AWS_ALLOWED_REGIONS`; redeploy.
- **Collection unavailable (`ResourceNotFoundException`):** *Detect* `face-preflight` FAIL / errors. *Contain* kill switch. *Recover* confirm the collection exists in eu-west-1; if lost, re-create + re-enroll (references are re-derivable, RPO 0).
- **Face Liveness unavailable:** *Detect* liveness sessions fail/timeout. *Contain* users see retry; no reference minted. *Recover* on service recovery, sessions resume (single-consume, idempotent).
- **CloudWatch outage:** *Impact* observability only — verification unaffected. *Contain* fall back to app alert webhook + `/api/admin/verification-metrics`. *Recover* alarms resume; backfill from app metrics.
- **CloudTrail unavailable:** *Impact* AWS-side audit only. *Contain* app `VerificationAuditEvent` remains the authoritative in-app trail. *Recover* restore trail; note the gap window in the postmortem.

---

## 4. Stripe incident playbooks

- **Identity webhook failure / signature mismatch:** *Detect* 401/400 on `/api/webhooks/verification`; Stripe dashboard failed deliveries. *Contain* app rejects unsigned/bad-sig (fail closed) — no state change. *Recover* verify `STRIPE_IDENTITY_WEBHOOK_SECRET` matches the endpoint's own secret (G1); Stripe auto-retries.
- **Billing webhook failure:** same on `/api/webhooks/stripe` with `STRIPE_WEBHOOK_SECRET`; subscriptions sync on retry (refetch-latest).
- **Duplicate webhook:** *Handled in code* — idempotent (`already_applied`); no double side effects. No action.
- **Webhook retry storm:** *Detect* elevated inbound. *Contain* rate-limit is fail-open (signature is the gate); idempotency prevents damage. *Recover* fix the underlying 5xx so Stripe stops retrying.
- **Stripe outage / Identity degradation:** *Detect* `provider_down` for `stripe_identity`; status.stripe.com. *Contain* new verifications fail closed per attempt; existing badges unaffected. *Recover* sessions reuse on retry; reconciler completes webhook-lost sessions.

---

## 5. Application incident playbooks

Queue stalled, dead-letter, manual-review overload, false-positive/negative, wrong calibration/threshold version, DB restore, cron failure → **FACE-VERIFICATION-RUNBOOK.md** (each with Detect/Impact/Respond/Recover/Postmortem). Additions:

- **Duplicate spike:** *Detect* duplicate-class metrics climb / `suspension_spike`. *Contain* impersonation auto-suspend already fires; confirm fraud vs a calibration regression via risk flags. *Recover* tighten `RISK_CRITICAL_AT` (fraud) or recalibrate (regression).
- **Appeal spike:** *Detect* `appeal_spike`. *Contain* triage; check reject accuracy. *Recover* recalibrate if FP-driven.
- **Unexpected approval spike / rejection spike:** *Detect* auto-verified/rejected rate anomaly. *Contain* freeze rollout phase; if approvals spike suspiciously → kill switch (possible threshold/spoof issue). *Recover* calibration review; sample audit.
- **Cache (Upstash/Redis) outage:** *Impact* rate limiting degrades **fail-open** (never blocks provider webhooks); no verification correctness impact. *Recover* restore Redis; limits resume.
- **Feature-flag mistake / wrong version:** *Detect* health/version drift, metric anomaly. *Contain* revert the env flag / re-pin the version (§2). *Recover* redeploy; confirm stamps.

---

## 6. Security incident playbooks

- **Credential / AWS key / Stripe secret exposure:** rotate at the vendor **immediately** → update Vercel env → redeploy; for AWS invalidate the IAM key pair; if the key had reference-read scope, `rotateReference(*, "policy_change")`. Audit vendor access logs for the exposure window. *(P0.)*
- **Suspected biometric compromise:** no biometric image path through Tirvea (references are opaque, vendor-side; `AuditImagesLimit:0`). Rotate all references + `DeleteCollection` at the vendor; unset provider while assessing; DPIA incident annex; regulator notification if personal data at risk. *(P0.)*
- **Database leak:** rotate DB creds + `SUPABASE_SERVICE_ROLE_KEY`; assess scope (no biometric images stored — only opaque FaceIds + metadata); GDPR 72h regulator assessment; force re-auth. *(P0.)*
- **Admin compromise / privilege escalation:** revoke the account; rotate `ADMIN_BOOTSTRAP_*` (should already be removed post-promotion); review AdminLog for actions in the window; RBAC is explicit (no hierarchy inference) — audit any permission change. *(P0.)*
- **Abuse / fake-verification campaign:** confirm via risk flags + duplicate detection; auto-suspend fires for impersonation; consider tightening cohort (`percent`) or kill switch; escalate to fraud review. *(P1.)*

---

## 7. Communications plan

| Audience | When | Channel | Owner |
|---|---|---|---|
| On-call / engineering | every P0–P2 | war-room channel + page | incident commander |
| Trust & Safety | trust-impacting (FP/FN/fraud) | T&S channel | on-call |
| Support | user-visible | support channel + macro | on-call |
| Management / CTO | P0/P1 | direct + summary | incident commander |
| Status page | user-visible degradation | public status page | comms owner |
| Customers | sustained user-visible impact | in-app safety-notice + email (existing calm copy) | support |
| Regulator / DPO | personal-data breach | per GDPR **72h** | DPO (DPIA workflow) |
| GDPR workflow | any personal-data incident | DPIA incident annex → assessment → notification decision | DPO |

---

## 8. Postmortem process (template)

Required for every P0/P1 (optional P2), within **5 business days**:

```
Incident:            <title> (<Pn>)
Detected:            <ts, how> (alert kind / report)
Resolved:            <ts>   Duration: <hh:mm>
Impact:              <users/badges/data affected — aggregates only>
Timeline:            <ts → event → action> (from VerificationAuditEvent + AdminLog)
Root cause:          <the single technical cause>
Contributing:        <factors>
Corrective actions:  <fix the cause>            owner / deadline
Preventive actions:  <stop recurrence>          owner / deadline
Detection gaps:      <missed signal → new alarm/threshold>
Verification:        <how each action is proven done>
Follow-up review:    <date>
KB updates:          <runbook/threshold/calibration doc changes>
```

Blameless. Evidence is audit rows + metrics + dashboards — **never** biometric images, FaceIds, or secrets. Adversarial samples from FN incidents are added to the calibration set (G3.2).

---

## Operator prerequisites (OPERATOR-CONFIRMED — org execution)

The *capability* above is complete and the controls are code-verified. Actual operational readiness also requires: an **on-call rotation** staffed, a **public status page** provisioned, a **regulator/DPO contact list** on file, and staff **trained** on the admin queue + these playbooks.
