# Realtime Chat (Phase 0G)

Supabase Realtime **private broadcast channels** replace the 5-second
message poll. One platform (already in the stack for auth), no second
realtime vendor.

## Trust model

- **PostgreSQL stays the source of truth.** Every message and receipt
  is written through the existing authorized API routes first; realtime
  only DELIVERS what the database already holds. A lost broadcast costs
  one recovery fetch, never a message.
- **Transport is never the authority.** All permission checks
  (participant membership, block rules, trust-safety ladder,
  first-message restrictions, moderation, rate limits, idempotency)
  run in the POST route exactly as before - a broadcast happens only
  after a write succeeded.
- **Browsers cannot subscribe to database changes.** There is no
  `postgres_changes` subscription anywhere. Clients join
  `conversation:<id>` broadcast channels marked `private: true`; the
  join is authorized by an RLS policy on `realtime.messages`
  (migration `20260713150000_realtime_chat_authorization`) through a
  SECURITY DEFINER membership function: participants of that
  conversation whose account status may use chat (`ACTIVE`,
  `SHADOW_BANNED`), nobody else. The app tables themselves stay
  deny-all under RLS.
- The server broadcasts over Realtime's REST endpoint with the service
  role (`src/lib/services/realtime.ts`) - no client-side secrets, no
  persistent socket from serverless.

## Events

| Event         | Emitted by                                              | Payload                                                     |
| ------------- | ------------------------------------------------------- | ----------------------------------------------------------- |
| `message:new` | `sendMessage` after the DB transaction                  | full message DTO + `serverTs` (ms) for latency metrics      |
| `receipt`     | `markRead` / `markDelivered`, only on real state change | `{ kind: "read" \| "delivered", byId, conversationId, at }` |

## Message states

- **sent** - the POST persisted the row (`status: SENT`).
- **delivered** - a recipient device acknowledged receiving it
  (`POST /conversations/:id/receipts { kind: "delivered" }`,
  SENT → DELIVERED).
- **read** - the recipient viewed the thread (`{ kind: "read" }` or the
  existing GET side effect, → SEEN + `lastReadAt`).

The ladder is one-way (SENT → DELIVERED → SEEN): late or out-of-order
receipts can never regress state - enforced in the DB `where` clauses
AND in the client store.

## Client behaviour (`useConversationChannel` + `lib/chat/thread-store`)

- **Duplicates are safe**: merging is keyed by message id; the same
  event via realtime + recovery fetch changes nothing the second time.
- **Out-of-order is safe**: ordering is `(createdAt, id)` - server
  time, never arrival order.
- **Reconnect**: exponential backoff 1s → 30s, plus an immediate
  attempt on tab visibility / network-online.
- **Missed-message recovery**: every successful (re)subscribe and every
  visibility regain triggers a fetch of the authorized GET, merged
  through the same dedupe rules.
- **No permanent polling**: while the channel is unhealthy a 15s
  recovery loop runs and stops the moment the channel is healthy again.
  The old unconditional 5s poll is gone (stability proven by the live
  suite below before removal).

## Metrics

The thread batches transport counters to `POST /api/analytics`
(`chat_transport`, counters only - no content, no ids): delivery count

- latency sum/max (from `serverTs`), reconnect count + duration,
  duplicate count, recovered-event count, degraded-fetch count.

## Tests

- `tests/thread-store.test.ts` (unit, 11 checks): dedupe, ordering,
  receipt ladder no-regress, optimistic confirm races.
- `tests/api-0g.test.ts` (live, 8 checks, real Realtime sockets):
  sender persist, recipient delivery (latency asserted), multi-device,
  unauthorized join REFUSED, read + delivered receipts, offline →
  reconnect → recovery, blocked conversation leaks nothing.

Local check: `npm run dev` + `npx tsx tests/api-0g.test.ts`.
Against production: `TEST_BASE_URL=https://tirvea.com npx tsx tests/api-0g.test.ts`.
