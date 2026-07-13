# Multi-Transport Notifications (Phase 0H)

One canonical notification event, fanned out through transport adapters.
Web Push is one adapter among three - not the domain model.

## Flow

```
notifyUser()  ->  Notification row (in-app truth)
   |               + NotificationDelivery outbox rows (idempotencyKey-unique)
   |  checks: self-actor, blocks (both directions), per-type preference,
   |          quiet hours (safety exempt), presence suppression,
   |          device availability
   v
processPendingPush()      <- after-response kick + cron sweep
   -> dispatchPushDelivery (CAS claim, attempt++, 5-min lease)
      -> sendPushToUser: every enabled device, ANY transport
         -> adapterFor(transport).send(...)   [notification-transports.ts]
```

Retry: exponential backoff via `nextAttemptAt`; `MAX_PUSH_ATTEMPTS = 4`,
then the delivery goes **DEAD** (dead-letter, kept with errorCode for
inspection). Idempotency: `dedupeKey` -> unique `idempotencyKey` per
channel - a duplicate canonical event is a no-op.

## Device model (`NotificationDevice`, mapped onto the PushSubscription table)

userId · transport (WEB_PUSH | APNS | FCM) · endpoint+p256dh/auth
(WEB_PUSH) or token (APNS/FCM, unique) · installationId (device id) ·
appVersion · environment (production/development) · enabled · lastSeenAt
· lastSuccess/FailureAt · failureCount · invalidatedAt · created/updatedAt.

## Security

- Only delivery material is stored; VAPID/APNs/FCM **private keys are
  env-only**, never in the DB.
- Tokens/endpoints are credentials: routes and logs only ever see
  truncated forms (`truncateEndpoint`, `truncateToken` - last 6 chars).
- **Rotation**: re-registering an installation with a new token retires
  the old row (`rotatedOut`); a token presented by a different account
  is rebound to the caller and audited.
- **Revocation**: `POST /api/push/unsubscribe { endpoint | token }`;
  rows are invalidated, never deleted (audit trail).
- **Invalid-token cleanup**: a provider "gone" signal (web push 404/410;
  APNs `BadDeviceToken`/FCM `UNREGISTERED` when those senders ship)
  invalidates the device immediately; repeated transient failures
  disable it at `MAX_ENDPOINT_FAILURES = 5`; the 90-day stale sweep
  (`revokeStaleSubscriptions`) stays.

## Registration

- `POST /api/push/register` - transport-independent (Phase 0H):
  `{ transport: "WEB_PUSH", subscription, ... }` or
  `{ transport: "APNS" | "FCM", token, installationId?, appVersion?,
environment?, platform? }`.
- `POST /api/push/subscribe` - unchanged web alias (same service call).

## Adapters (`src/lib/services/notification-transports.ts`)

- `WEB_PUSH` - live; wraps the injectable web-push transport.
- `APNS` / `FCM` - registration, storage, rotation and fan-out are live;
  `send` answers `transport_not_configured` until the native senders
  ship (**no native SDKs in this phase, no fake sends**). Devices on an
  unconfigured transport are _skipped_ by fan-out - never failure-punished.
  Reserved env names: `APNS_KEY_ID/APNS_TEAM_ID/APNS_PRIVATE_KEY/
APNS_BUNDLE_ID`, `FCM_SERVICE_ACCOUNT_JSON`.
- Test seams: `setTransportAdapter(transport, fake)` + `fakeAdapter(...)`
  (and the original `setPushTransport` web-push spy).

## Categories

Transport-independent, unchanged: `engagement` / `safety` / `account`
(`categoryOf` in notify.ts) driving per-type preferences and quiet-hours
exemptions.

## Metrics (`notification-metrics.ts`)

Per transport: attempted, delivered, failed, invalid token, retry count,
latency sum/max - in-process counters + a throttled
`[notify:metrics] ...` structured log line. Never receives tokens,
endpoints or content.

## Tests

- `tests/notifications.test.ts` (30 checks) - the existing web-push
  behavior, passing unchanged through the adapter path.
- `tests/api-0h.test.ts` (10 checks) - FCM/APNS registration, rotation,
  rebind audit, truncation, fake-adapter fan-out, dedupe, invalid-token
  cleanup, retry -> dead-letter, unconfigured-transport skip, revocation
  by token.
