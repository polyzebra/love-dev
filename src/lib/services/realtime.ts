/**
 * Server-side Supabase Realtime broadcast (Phase 0G).
 *
 * PostgreSQL stays the source of truth and every write stays on the
 * authorized API routes - realtime is a DELIVERY layer only. After a
 * successful write, the server broadcasts to the conversation's PRIVATE
 * channel over Realtime's REST endpoint (service role; no persistent
 * socket from serverless). Browsers can only JOIN those channels through
 * the RLS policy in migration 20260713150000 - participants with
 * chat-capable accounts, nobody else - and can never subscribe to
 * database changes directly.
 *
 * Delivery here is best-effort BY DESIGN: a lost broadcast costs one
 * recovery fetch on the client (never a lost message - the DB has it).
 * Failures are logged (throttled) and never fail the calling write.
 */

/** Channel topic for one conversation - keep in sync with the RLS policy. */
export function conversationTopic(conversationId: string): string {
  return `conversation:${conversationId}`;
}

export type ConversationRealtimeEvent =
  /** payload: the full message DTO + serverTs (ms) for latency metrics */
  | "message:new"
  /** payload: { kind: "delivered" | "read", byId, conversationId, at } */
  | "receipt";

const BROADCAST_TIMEOUT_MS = 3_000;
const OUTAGE_LOG_INTERVAL_MS = 30_000;
let lastErrorLogAt = 0;

function logBroadcastError(detail: string): void {
  const now = Date.now();
  if (now - lastErrorLogAt < OUTAGE_LOG_INTERVAL_MS) return;
  lastErrorLogAt = now;
  console.warn(`[realtime] broadcast failed (clients recover via fetch): ${detail.slice(0, 160)}`);
}

/**
 * Broadcast one event to a conversation's private channel. Awaitable but
 * never throws; resolves false when realtime is unconfigured/unavailable.
 */
export async function broadcastToConversation(
  conversationId: string,
  event: ConversationRealtimeEvent,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) return false;

  try {
    const res = await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          {
            topic: conversationTopic(conversationId),
            event,
            payload,
            private: true,
          },
        ],
      }),
      signal: AbortSignal.timeout(BROADCAST_TIMEOUT_MS),
    });
    if (!res.ok) {
      logBroadcastError(`HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (error) {
    logBroadcastError(String(error));
    return false;
  }
}
