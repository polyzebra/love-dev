# G6 — Production Monitoring Runbook (Face Verification)

Operator-facing. The application already emits a complete, **anonymous** metric
set and a working alert engine; this runbook maps them to dashboards, alarms,
severities, and periodic checklists. It never exposes biometric data or secrets.

## Sources (where the numbers come from)

- **App metrics:** `computeVerificationMetrics(windowDays)` → served by `GET /api/admin/verification-metrics` (anonymous aggregates only).
- **App alerts:** `evaluateVerificationAlerts()` (cron `/api/cron/face-checks`, every 10 min) → external webhook `ALERT_WEBHOOK_URL`; each kind fires ≤1×/day (dedupe) and auto-resolves.
- **Provider health:** `provider-resilience.ts` circuit breaker → `providers.{stripe_identity, face_match:aws_rekognition_faces}` ∈ `OK|DEGRADED|UNAVAILABLE`.
- **Config/state alerts:** `evaluateProviderConfigAlerts()` (region mismatch, emergency-disable, misconfig).
- **Audit trail:** `VerificationAuditEvent` (types: `liveness_*`, `face_check_run`, `duplicate_check`, `face_auto_suspend`, `photo_grant_*`, `face_consent_withdrawn`, `face_data_deleted`, `ops_alert`, …).
- **Health:** `GET /api/health` (status/database/config/billing).
- **AWS/Stripe:** CloudWatch + Stripe Dashboard (operator-side, below).

## Dashboards (build in your observability stack; refresh 1–5 min)

**Operations** — KPIs: verification success rate, avg/p95 duration, queue depth, oldest-queued minutes, dead-lettered count, provider health. Widgets: identity funnel (started→approved/rejected/expired), face funnel (runs→auto/review/reject/suspend), queue depth+age timeseries, provider-health status tiles. Drill-down: `/api/admin/verifications`, `/api/admin/safety/providers`.

**Trust & Safety** — KPIs: manual-review rate, duplicate detection by class, suspensions/24h, appeal rate. Widgets: review-queue depth, duplicate-class breakdown, suspension timeseries, appeals funnel. Drill-down: `/api/admin/safety/{cases,users,appeals}`.

**Security** — KPIs: risk-band distribution, false-positive proxy (overturned adverse), false-negative proxy (post-grant suspensions), auto-suspend count, config-alert state. Widgets: risk-band stacked bars, FP/FN proxy trend, provider-config alert tile. Drill-down: `/api/admin/safety/cases`.

**Support** — KPIs: pending manual reviews, open appeals, avg time-to-decision. Widgets: review/appeal queues, SLA aging. Drill-down: `/api/admin/verifications/[id]`.

**Executive** — KPIs: verification success %, total verified users, manual-review %, incident count, cost trend. Widgets: weekly success trend, volume, cost (Rekognition calls × unit), incident tally. Refresh: hourly/daily.

## Alerts — severity matrix

| Alert kind | Condition (source) | Default threshold (env) | Severity | Notify | Operator action |
|---|---|---|---|---|---|
| `provider_down` | provider `UNAVAILABLE` | — | **Critical** | page | verify AWS/Stripe; jobs park safely; consider kill switch if persistent |
| `provider_degraded` | provider `DEGRADED` | — | High | page | watch queue; check circuit-breaker cooldown |
| `queue_stalled` | oldest queued > `ALERT_QUEUE_STALL_MINUTES` | 60 min | High | page | check worker/cron + provider; scale sweep batch |
| `face_dead_letter` | deadLettered > `ALERT_DLQ_MAX` | 0 | High | page | inspect DLQ cause; replay after fix |
| `suspension_spike` | suspended > `ALERT_SUSPENSION_MAX` | 25/24h | High | notify | check for a fraud wave or a bad threshold |
| `manual_review_spike` | reviewRate > `ALERT_MANUAL_REVIEW_PCT` | 40% | Medium | notify | recalibrate thresholds; staff the queue |
| `false_positive_spike` | overturn% > `ALERT_FALSE_POSITIVE_PCT` | 20% | High | notify | thresholds too strict/broken → calibration review |
| `verification_spike` | started > `ALERT_VERIFICATION_SPIKE` | 500/24h | Medium | notify | confirm organic vs attack |
| `appeal_spike` | appeals > `ALERT_APPEAL_SPIKE` | 25/24h | Medium | notify | check reject accuracy |
| provider-config | region mismatch / emergency-disable / misconfig | — | **Critical** | page | fix config immediately (fail-closed until then) |

**CloudWatch alarms (operator, AWS-side — not app-emitted):** AWS `AccessDenied`, `AssumeRole` failure, Rekognition `ThrottlingException`, Rekognition 5xx, **STS latency** p95, Rekognition latency p95. Route to the same on-call. (STS/Rekognition throttling and IAM denials are only visible in CloudWatch.)

**Stripe monitoring (operator, Stripe Dashboard):** Identity endpoint `/api/webhooks/verification` + Billing endpoint `/api/webhooks/stripe` — failed deliveries, retry counts, signature failures (the app returns 401/400 and logs an event, but delivery/retry stats live in Stripe), processing latency.

## Incident checklist

1. Acknowledge the alert (kind + detail from the webhook).
2. Open the relevant dashboard; confirm the metric.
3. If provider `UNAVAILABLE`/config-alert → **`FACE_EMERGENCY_DISABLE=1`** (kill switch) or roll back the rollout phase (`FACE_VERIFICATION_PERCENT` → previous/0).
4. If threshold-driven (review/FP/suspension spike) → freeze the rollout phase; open a **calibration review**.
5. Verify jobs are parking safely (no fabricated matches) via audit.
6. Communicate (status page + internal); after resolution, confirm the auto-resolve fired.
7. Post-incident: capture root cause; adjust `ALERT_*` thresholds if noisy.

## Periodic checklists

**Daily**
- [ ] `/api/health` = healthy (db/config/billing ok).
- [ ] No unresolved `ops_alert` from the last 24h.
- [ ] Provider health all `OK`; queue depth + oldest-queued nominal; dead-lettered = 0.
- [ ] Manual-review + suspension counts within band.

**Weekly**
- [ ] Verification success trend ≥ target; FP/FN proxies stable.
- [ ] Duplicate-class distribution sane; appeal rate stable.
- [ ] Rekognition/STS latency p95 within target (CloudWatch).
- [ ] Alert noise review — tune `ALERT_*` if firing spuriously.

**Monthly**
- [ ] Cost review (Rekognition calls × unit) vs volume.
- [ ] Capacity review: queue throughput vs peak; sweep batch/lease sizing.
- [ ] Access review: IAM least-privilege still holds (G2); rotate secrets on schedule.
- [ ] Dashboard review: every KPI still wired; drill-downs valid.

**Capacity review** — worker throughput vs verification volume, queue-age p95, DLQ rate, provider rate-limit headroom.

**Calibration review** — FP/FN proxies vs the last measured FAR/FRR; if drift → re-run G3.2 calibration, bump `FACE_CALIBRATION_VERSION`.

**Dashboard review** — confirm all five dashboards render, refresh, and drill-down; confirm **no** FaceId / image / secret / PII appears (aggregates only).

## Privacy guarantee

Every metric is an anonymous aggregate — no user ids, FaceIds, biometric values, vendor identifiers, session tokens, or secrets appear in any dashboard payload (`verification-metrics.ts` contract; verified). Dashboards must be built only from `/api/admin/verification-metrics` + the admin safety endpoints, never from raw biometric tables.
