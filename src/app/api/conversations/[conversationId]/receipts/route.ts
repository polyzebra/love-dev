import { forbidden, guardRate, ok, parseBody, requireActiveAccount } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { receiptSchema } from "@/lib/validators/chat";
import { assertParticipant, markDelivered, markRead } from "@/lib/services/chat";

type Params = { params: Promise<{ conversationId: string }> };

/**
 * POST /api/conversations/[conversationId]/receipts - message state
 * transitions from the RECIPIENT's side (Phase 0G):
 *   { kind: "delivered" } - my device received the other side's messages
 *     (SENT -> DELIVERED; never regresses SEEN)
 *   { kind: "read" }      - I am looking at them (-> SEEN + lastReadAt)
 * Both are idempotent (repeat calls change nothing) and broadcast a
 * `receipt` event to the conversation's private channel only when state
 * actually changed. Sender status ("sent") is stamped by message create.
 */
export async function POST(req: Request, { params }: Params) {
  const { conversationId } = await params;
  const { user, response } = await requireActiveAccount();
  if (response) return response;

  const limited = await guardRate(`receipt:${user.id}`, RATE_LIMITS.message);
  if (limited) return limited;

  const participant = await assertParticipant(conversationId, user.id);
  if (!participant) return forbidden();

  const { data, response: invalid } = await parseBody(req, receiptSchema);
  if (invalid) return invalid;

  const updated =
    data.kind === "read"
      ? await markRead(conversationId, user.id)
      : await markDelivered(conversationId, user.id);

  return ok({ kind: data.kind, updated });
}
