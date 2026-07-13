# Tirvea API v1 — Transport Contract (Phase 0D)

Canonical surface: **`/api/v1/*`** — a transparent rewrite onto the
route handlers (the transport contract is versioned; domain services
are not). Bare `/api/*` is the **frozen legacy alias** for the current
web client during migration.

Machine-readable schemas: `src/lib/api-contract/*` (Zod, framework-free).
Typed client: `src/lib/api-client` (web, Capacitor, native, test tooling).
Request-body schemas remain in `src/lib/validators/*` — the same objects
the routes validate with.

## Envelopes

Success (2xx): `{ "data": ... }`
Error (non-2xx): `{ "error": { "code", "message", "fields?" } }`

- `code`: machine-readable, from the registry in
  `api-contract/envelope.ts` (`ERROR_STATUS` maps every code to its
  guaranteed status). The registry is OPEN — codes may be ADDED in v1;
  removing or re-meaning one requires `/api/v2`.
- `message`: safe user-facing copy. Never stack traces, database or
  Prisma details, secrets, or personal information.
- `fields`: per-field messages, on `validation_error` (422) only.

Status conventions: 401 `unauthorized` · 403 `forbidden` /
`account_restricted` · 404 `not_found` · 409 domain conflicts
(`already_subscribed`, `upgrade_pending`, …) · 422 `validation_error` ·
429 `rate_limited` (+ `Retry-After` header) · 5xx `internal_error` /
`billing_unavailable` / `auth_unavailable` (all intentionally generic).

### Auth-funnel migration note

The OTP send/verify routes historically answered `{ ok, retryAfter }` /
`{ ok: false, error: "<string>" }`. They now speak the standard envelope
with the legacy keys **mirrored** (`ok`, top-level success fields,
top-level `code`). The mirrors are DEPRECATED and are removed together
with the legacy alias (below). New clients must read only `data` / `error`.

## Correlation

Every API response carries `X-Request-Id`. A client-supplied
`X-Request-Id` matching `[A-Za-z0-9._-]{8,64}` is honored; anything else
is replaced with a server-generated UUID. Send it with bug reports; it
is attached to the request server-side for log correlation.

## Pagination (list endpoints)

Request: `?limit=1..100` (default 20) and optional opaque `cursor`.
Response `data`: `{ "items": [...], "nextCursor": "..." | null }` —
`null` is the only end-of-list signal. Cursors are server-issued and
opaque; clients never construct or parse them. Schemas:
`api-contract/pagination.ts`.

## Idempotency (unsafe mutations)

Opt-in via the `Idempotency-Key` header (8–128 chars,
`[A-Za-z0-9._:-]`). Semantics (`api-contract/idempotency.ts`):
same user + same endpoint scope + same key → the first execution's
response is stored and REPLAYED (marked `Idempotency-Replayed: true`).
Only non-5xx responses are stored — a 5xx may be retried with the same
key. Keys are valid 24h. Honoured today by
`POST /api/v1/conversations/:id/messages`; billing mutations are already
idempotent server-side via state-derived Stripe keys.

## Versioning & deprecation rules

1. `/api/v1` is canonical. **Additive** changes (new endpoints, new
   optional fields, new error codes) ship freely within v1.
2. **Breaking** changes (removing/renaming fields, changing types or
   semantics, re-meaning an error code) require `/api/v2`; v1 keeps
   working alongside it.
3. The bare `/api/*` legacy alias and the auth-funnel legacy key mirrors
   are frozen. Removal happens no sooner than **6 months after the first
   native client ships on v1**, announced via a `Deprecation` response
   header on the alias for at least 90 days before removal.
4. Clients that cannot be force-updated (native apps) must only ever be
   pointed at a versioned path.

## Client usage

```ts
import { createTirveaClient } from "@/lib/api-client";

// Web (same-origin cookies):
const api = createTirveaClient();

// Native/Capacitor (Bearer transport, Phase 0C):
const api = createTirveaClient({
  baseUrl: "https://tirvea.com",
  getAccessToken: () =>
    supabase.auth.getSession().then((s) => s.data.session?.access_token ?? null),
});

const res = await api.billing.previewChangePlan("GOLD");
if (res.ok) console.log(res.data.amountDueCents, res.requestId);
else console.log(res.error.code, res.error.message);
```

Coverage policy: core endpoints gain typed methods as clients adopt
them; `api.raw()` reaches everything else with the same envelope
handling, auth and correlation. Adding a method = response schema + a
one-liner.
