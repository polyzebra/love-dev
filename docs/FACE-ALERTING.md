# Face Verification — Alerting Runbook

The operational alert channel for the face layer: what fires, how it is
delivered, and how to test it. Alerting is orthogonal to the lifecycle states
— it should be **active before** a rehearsal (it is the rehearsal
`alert_channel_active` gate) and must stay active through rollout.

## Channel

One external webhook, `ALERT_WEBHOOK_URL`, independent of the in-app
notification outbox (`src/lib/services/provider-resilience.ts`). It is
Slack / Discord / PagerDuty / Opsgenie-compatible. The payload carries only:

```
{ kind, severity, status: "firing" | "resolved", detail }
```

`detail` is composed from **counts and thresholds only** — never personal or
biometric data. Delivery is best-effort: a channel failure is caught and
recorded, never thrown, so an alert outage cannot crash a user flow. The
notification outbox is the secondary path. `isExternalAlertChannelConfigured()`
= `Boolean(override || ALERT_WEBHOOK_URL)` — this is the rehearsal gate.

## Deduplication

Alerts dedupe on `ops-alert:${kind}:${date}` where `date` is the UTC day —
**at most one firing alert per kind per day**. `resolveOpsAlert(kind)` emits
the `resolved` transition when the condition clears. This means a persistent
condition pings once/day, not continuously.

## Rules and thresholds

Config/state rules (env + adapter state; evaluated every cron sweep) and rate
rules (24h aggregates) live in `verification-metrics.ts`; severities in
`ALERT_POLICY` (`provider-resilience.ts`).

| kind | severity | Fires when | Threshold env (default) |
|------|----------|-----------|-------------------------|
| `provider_down` / `provider_degraded` | critical / warning | breaker open / elevated errors | `PROVIDER_UNAVAILABLE_AT` (8) / `PROVIDER_DEGRADED_AT` (3) |
| `credential_failure` | critical | AWS auth rejected | — |
| `queue_stalled` | high | oldest queued job too old | `ALERT_QUEUE_STALL_MINUTES` (60) |
| `face_dead_letter` | high | DLQ depth over max | `ALERT_DLQ_MAX` (0) |
| `reference_deletion_failure` | high | deletions failing | — |
| `verification_spike` | warning | runs/24h high | `ALERT_VERIFICATION_SPIKE` (500) |
| `appeal_spike` | warning | appeals/24h high | `ALERT_APPEAL_SPIKE` (25) |
| `false_positive_spike` | high | overturned adverse % high | `ALERT_FALSE_POSITIVE_PCT` (20) |
| `suspension_spike` | high | suspensions/24h high | `ALERT_SUSPENSION_MAX` (25) |
| `manual_review_spike` | warning | manual-review % high | `ALERT_MANUAL_REVIEW_PCT` (40) |
| `cron_failure` | high | the sweep threw | — (error NAME only, no PII) |
| `legal_gate_missing` | critical | prod + AWS provider + no legal version | — |
| `region_mismatch` | critical | `AWS_REGION` ≠ `AWS_REKOGNITION_REGION` | — |
| `emergency_disable_active` | high | `FACE_EMERGENCY_DISABLE=1` | — |

Unknown kinds fall back to `{ warning, 120 }`.

## Testing the channel (admins / CLI only)

Send ONE synthetic alert through the external channel — no outbox, no audit,
never throws:

```
npm run ops:alert-test [-- "a note"]         # prints {channelConfigured, delivered}
```

or `POST /api/admin/ops-alert-test` (permission `verifications:review`). Use
this to confirm the webhook before a rehearsal, and after any webhook URL
change. A dormant local env correctly reports `channelConfigured: false`.

## Responding

- **`legal_gate_missing` / `region_mismatch`** (critical, config errors): the
  layer is misconfigured — fix env or roll back (FACE-EMERGENCY-ROLLBACK.md).
  `region_mismatch` means `AWS_REGION` and `AWS_REKOGNITION_REGION` disagree.
- **`provider_down` / `credential_failure`**: vendor/credential incident;
  the breaker already fails safe. Rotate credentials on `credential_failure`
  (they are not retried, unlike transient errors).
- **`suspension_spike` / `manual_review_spike` / `false_positive_spike`**:
  a likely calibration problem — review and recalibrate
  (FACE-CALIBRATION.md).
- **`face_dead_letter` / `reference_deletion_failure`**: let the sweep drain;
  investigate if it will not (FACE-EMERGENCY-ROLLBACK.md Tier 3).
- **`cron_failure`**: the sweep threw; the alert carries the error name only.
  Check the cron logs.
- **`emergency_disable_active`**: expected during a Tier 1 rollback; otherwise
  someone set the kill switch — confirm it was intentional.
