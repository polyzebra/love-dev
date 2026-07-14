# Observability (Phase 0M)

Structured signals over the new architecture. Vercel request logs are
the correlation backbone (route, status, duration and our stamped
`X-Request-Id` appear on every line); targeted structured events cover
what platform logs cannot see. No metrics vendor required; every event
is a greppable line, swappable for a drain later.

## Dimension map

| Dimension                                    | Where it lives                                                                                                                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| request ID                                   | `X-Request-Id` response header (stamped in proxy.ts, client-honored when well-formed) + Vercel request logs                                                             |
| API version                                  | route path (`/api/v1/*` canonical vs bare legacy alias)                                                                                                                 |
| route / response status / duration           | Vercel request logs (per invocation)                                                                                                                                    |
| auth transport                               | `[auth] transport=bearer ...` events (cookie is the uninstrumented default; bearer successes are silent, rejections log a reason)                                       |
| rate-limit result                            | `[rate-limit] blocked action=<action> [degraded] retryInMs=` + `[rate-limit] store outage ...` (throttled)                                                              |
| realtime delivery outcome                    | `[realtime] broadcast failed ...` (throttled; success is silent - a lost broadcast costs one recovery fetch) + client `chat_transport` analytics counters               |
| notification transport outcome + retry count | `[notify:metrics] transport=... attempted/delivered/failed/invalidToken/retries/latency` (throttled aggregate) + `NotificationDelivery` rows (status/attempt/errorCode) |
| safe error code                              | `[api] error status=5xx code=<code>` + the error envelope itself                                                                                                        |

## Never logged (enforced by design, verified in review)

Access/refresh tokens (transport.ts never logs token material; bearer
rejections log the REASON only), full push tokens/endpoints (truncated
forms only - `truncateToken`/`truncateEndpoint`), OTP values (auth
funnel logs event types + masked phone), message bodies (push payloads
and logs carry generic copy; `chat_transport` is counters-only),
private media URLs (proxy paths only; signed URLs are `no-store` and
never logged), raw IPs in limiter keys/logs (salted hashes, and only
the action segment reaches logs).

## Dashboards / documented queries

1. **Authentication failures** - log filter `[auth] transport=bearer rejected`
   plus SQL over the audit trail:
   ```sql
   SELECT type, count(*) FROM "AuthVerificationEvent"
   WHERE "createdAt" > now() - interval '1 hour'
     AND type IN ('otp_verify_fail','otp_verify_locked','auth_login_failed',
                  'auth_phone_code_failed','email_attach_verify_fail')
   GROUP BY type ORDER BY count(*) DESC;
   ```
2. **API error rate** - Vercel logs: filter `status>=500` on `/api/*`
   (or grep `[api] error status=`); alert when >1% of requests over 5m.
3. **API latency p50/p95/p99** - Vercel Observability > per-route
   duration percentiles on `/api/*` (platform-computed).
4. **Rate-limit events** - grep `[rate-limit] blocked` (volume per
   action) and `[rate-limit] store outage` (any occurrence = page).
5. **Realtime failures** - grep `[realtime] broadcast failed`; client
   side, `AnalyticsEvent` rows:
   ```sql
   SELECT count(*) FROM "AnalyticsEvent"
   WHERE name = 'chat_transport' AND "createdAt" > now() - interval '1 day'
     AND (data->>'recovered')::int > 0;  -- events realtime missed
   ```
6. **Notification failures** - grep `[notify:metrics]` for
   failed/invalidToken rates, plus dead-letter watch:
   ```sql
   SELECT channel, "errorCode", count(*) FROM "NotificationDelivery"
   WHERE status = 'DEAD' AND "createdAt" > now() - interval '1 day'
   GROUP BY channel, "errorCode";
   ```
7. **Webhook failures** - Vercel logs: `status>=400` on
   `/api/webhooks/*` (signature rejects are 4xx; 5xx = processing bug);
   Stripe dashboard mirrors delivery retries.
8. **Billing reconciliation failures** - grep `[billing]` error lines
   from reconcile/webhook sync, plus drift check:
   ```sql
   SELECT s."userId", s.tier, s.status FROM "Subscription" s
   WHERE s.status NOT IN ('ACTIVE','TRIALING','CANCELED','PAST_DUE')
      OR (s."stripeSubscriptionId" IS NULL AND s.tier <> 'FREE');
   ```

Cadence: the queries above are the review set; wire them into a cron or
a dashboard product when operational load justifies it.
