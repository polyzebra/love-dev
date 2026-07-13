# Rate Limiting (Phase 0F)

Two complementary layers protect abuse-sensitive operations. Both are
distributed - limits hold across serverless instances, deployments and
regions.

## Layer 1 — auth funnel (DB-backed, authoritative, unchanged)

`src/lib/auth/rate-limit.ts` counts `AuthVerificationEvent` rows, so the
limiter and the audit trail can never disagree and every instance sees
the same truth. It covers OTP send/verify for email login, phone change,
phone login and email attach: escalating per-identifier resend cooldowns
(30s → 60s → 120s), 5 sends/hour per identifier, 10 sends/hour per IP
hash, and 5-failure/15-minute verify locks per identifier AND per IP
hash. **These are stricter than a generic counter and stay
authoritative — the Redis layer deliberately does not duplicate them.**

## Layer 2 — product routes (shared-store counters)

`src/lib/rate-limit.ts` provides fixed-window counters via `guardRate`
in `src/lib/api.ts`.

**Store selection** (no code change to activate):

| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | Store                                                                                                           |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| set (non-empty)                                       | Upstash Redis over REST (`INCR` + `PEXPIRE NX` + `PTTL` pipeline — atomic across instances, TTL can never leak) |
| unset                                                 | Per-instance memory (dev/CI); production logs a one-time warning                                                |

Activation: create an Upstash Redis database (or the Vercel Marketplace
integration), set both env vars in Vercel, redeploy. Rollback: unset
them. Values are documented by name only — never commit them.

## Keys

`rl:<action>:<principal>` where the principal is a **userId** or an
**IP hash** (`ipHashFrom` — salted SHA-256, see `AUTH_HASH_SALT`).
Raw IPs never appear in keys. Logs carry only the `<action>` segment,
never any principal, hashed or not.

## Failure semantics — explicit per route

Every preset/inline budget declares `failMode`:

- **`closed`** — a store outage REJECTS the request (429, 30s retry).
  For operations where running unprotected is worse than a brief
  rejection: `billing` (all 8 endpoints), `report`, `pushTest`,
  verification photo start (paid provider), appeal creation, admin
  bootstrap.
- **`open`** — a store outage falls back to a per-instance memory
  limiter enforcing the SAME budget: degraded (per-instance rather than
  global) but never unprotected, and the outage is logged (throttled to
  one line per 30s). For product surfaces where availability wins:
  `swipe`, `message` (+ first messages), `api` (discovery/explore),
  `upload`, `profileWrite`, `pushSubscribe`, `presenceHeartbeat`,
  appeal management, and the provider webhooks (Stripe/email/
  verification must never bounce on a store blip — their signature
  checks are the real gate).

The auth funnel needs no failMode: its store IS the primary database;
if that is down, the request fails before any limit is consulted.

## Response contract

Blocked requests return `429` with the standard envelope plus retry
information, and a `Retry-After` header (seconds):

```json
{ "error": { "code": "rate_limited", "message": "…", "retryAfter": 42 } }
```

## Budgets

See `RATE_LIMITS` in `src/lib/rate-limit.ts` — every budget is named
and deliberate. Notable Phase 0F additions: `upload` (30/h, previously
the generic 300/min `api` budget) and `profileWrite` (60/15min on
settings, profile, preferences, prompts and onboarding writes, which
previously had no guard).

## Observability

- Store outages: `[rate-limit] store outage action=<action>
failMode=<mode> error=<truncated>` — at most one line per 30s per
  instance.
- Unconfigured store in production: one `[rate-limit] …not set` warning
  at first use.
- No raw IPs, no user ids, no key principals in any log line.

## Tests

- `tests/rate-limit.test.ts` (unit): allowed / threshold / blocked /
  window reset / per-key isolation / 20-way concurrency / fail-open and
  fail-closed outage behaviour / log throttling / Upstash wire protocol
  with injected fetch / preset failMode contract.
- `tests/api-0f.test.ts` (live): allowed → 429 envelope + Retry-After →
  per-principal isolation → window reset on a real guarded route.
