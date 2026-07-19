import { z } from "zod";
import { forbidden, guardRate, ok, parseBody, requireActiveAccount } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { assertParticipant } from "@/lib/services/chat";
import { heartbeatPresence } from "@/lib/services/notify";

const heartbeatSchema = z.object({ conversationId: z.string().min(1).max(64) }).strict();

/**
 * POST /api/presence/heartbeat - "I am looking at this conversation right
 * now". The client pings every ~10s while a conversation is open; the
 * notify pipeline suppresses push for messages arriving into a
 * conversation whose recipient heartbeated within the last 30s.
 */
export async function POST(req: Request) {
  const { user, response } = await requireActiveAccount();
  if (response) return response;

  const { data, response: invalid } = await parseBody(req, heartbeatSchema);
  if (invalid) return invalid;

  const limited = await guardRate(
    `presence:${user.id}:${data.conversationId}`,
    RATE_LIMITS.presenceHeartbeat,
  );
  if (limited) return limited;

  const participant = await assertParticipant(data.conversationId, user.id);
  if (!participant) return forbidden();

  await heartbeatPresence(user.id, data.conversationId);
  return ok({ ok: true });
}
