# Architecture Boundaries (Phase 0K)

Dependency direction, machine-enforced by `tests/architecture.test.ts`
(unit lane - a violation fails CI):

```
UI / route adapters        src/app/**, src/components/**, src/lib/api.ts,
                           src/lib/auth.ts, src/lib/auth/require-user.ts
        |
Application services       src/lib/services/**, src/lib/chat/**
        |
Domain rules               src/lib/validators/**, src/lib/api-contract/**,
                           src/lib/rbac.ts, src/lib/auth/transport.ts,
                           src/lib/auth/rate-limit.ts (policy over DB facts)
        |
Infrastructure interfaces  seams listed below; their IMPLEMENTATIONS live
                           in allowlisted adapter modules
```

The domain/application layer may not import Next.js, React, the DOM
(`window`/`document`/`localStorage`/`navigator`), `@supabase/ssr`, the
cookie-bound `supabase/server` helper, the HTTP route layer
(`lib/api.ts`), or payment SDK UI packages. Prisma (`lib/db`) is the
domain's OWN persistence and deliberately not abstracted - swapping ORMs
is not a live requirement, and a repository layer today would be
abstraction for style (forbidden by this phase's charter).

## Interface inventory

| Concern                 | Seam                                                                                         | Adapter / implementations                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Authentication identity | `decideIdentity` / `parseAuthorizationHeader` (pure) + the canonical principal from `auth()` | `lib/auth.ts` (cookies + Bearer, Phase 0C)                                             |
| Notifications           | `NotificationTransportAdapter` + `setTransportAdapter`/`fakeAdapter`                         | web-push live; APNS/FCM stubs (Phase 0H)                                               |
| Billing provider        | `StripeClient` interface + injection seam                                                    | `lib/stripe.ts` (SDK-free fetch client)                                                |
| Moderation provider     | `ModerationProvider` + `pickProvider`                                                        | null/external/mock providers                                                           |
| Storage                 | `storageClient()` / `storageServiceClientOrNull()`                                           | `lib/storage.ts` (service role, keyless-dev fallback)                                  |
| Realtime delivery       | `broadcastToConversation` (fetch-only)                                                       | Supabase Realtime REST (Phase 0G)                                                      |
| Clock/time              | `now: Date = new Date()` parameters on time-sensitive services (outbox, limiter, sweeps)     | injected by tests; no global clock object - a Clock interface would be style, not need |
| Rate limiting           | `RateLimitStore` + `createRateLimiter` factory                                               | Upstash / memory (Phase 0F)                                                            |
| Response scheduling     | `deferAfterResponse`                                                                         | `lib/defer.ts` (Next `after()`, detached-promise fallback)                             |

## What Phase 0K changed (audit -> 3 real violations, all fixed)

1. `services/notify.ts` imported `next/server` for `after()` - now goes
   through the `deferAfterResponse` seam.
2. `services/photos.ts` and `services/moderation.ts` did storage I/O
   with the cookie-bound `supabaseServer()` request helper - now through
   `lib/storage.ts` (service role; route authorization is the boundary,
   same rationale as Phase 0I).
3. `services/media.ts` carried its own private copy of the service-role
   storage client - deduplicated into `lib/storage.ts`.

Everything else already conformed: routes own HTTP/authz concerns,
services own mutations, the client-side helpers that legitimately touch
React/DOM (`lib/auth/phone-tools.ts`, `lib/supabase/client.ts`,
`lib/api-client/browser.ts`) are UI-layer adapters and are outside the
enforced domain directories by design.

## Rules of engagement

- New service code MUST NOT import from the forbidden list; add a seam
  in an adapter module if a platform capability is genuinely needed.
- Do not add interfaces speculatively. A boundary earns its existence by
  a real second implementation (test fake, second provider, second
  platform) - each seam above has one.
