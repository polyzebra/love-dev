import {
  apiError,
  forbidden,
  guardRate,
  created,
  ok,
  requireSession,
  withIdempotency,
} from "@/lib/api";
import { canEngage, sweepExpiredRestrictions } from "@/lib/services/trust-safety";
import { parseBody } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { sendMessageSchema } from "@/lib/validators/chat";
import { assertParticipant, listThreadMessages, markRead, sendMessage } from "@/lib/services/chat";
import { schedulePushDispatch } from "@/lib/services/notify";
import { db } from "@/lib/db";

type Params = { params: Promise<{ conversationId: string }> };

export async function GET(req: Request, { params }: Params) {
  const { conversationId } = await params;
  const { user, response } = await requireSession();
  if (response) return response;

  const participant = await assertParticipant(conversationId, user.id);
  if (!participant) return forbidden();

  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor");
  const take = Math.min(Number(url.searchParams.get("take") ?? 50), 100);

  const page = await listThreadMessages(conversationId, { take, cursor });
  await markRead(conversationId, user.id);

  return ok(page);
}

export async function POST(req: Request, { params }: Params) {
  const { conversationId } = await params;
  const { user, response } = await requireSession();
  if (response) return response;

  // v1 idempotency (opt-in via Idempotency-Key): a duplicate send - the
  // classic double-tap / flaky-network retry - replays the first
  // response instead of creating a second message. Replays run BEFORE
  // rate limiting: no new work, no consumed budget.
  return withIdempotency(user.id, `messages:send:${conversationId}`, req, async () => {
    const limited = await guardRate(`message:${user.id}`, RATE_LIMITS.message);
    if (limited) return limited;

    // Trust-safety ladder: LIMITED accounts cannot send chat messages
    // (suspended/banned are already refused by requireSession). The sweep
    // lifts an expired restriction on the spot.
    const status = (await sweepExpiredRestrictions(user.id)) ?? user.status;
    if (!canEngage(status)) {
      return apiError(
        403,
        "account_limited",
        "Sending messages is paused on your account for now. Check your account status for details.",
      );
    }

    const participant = await assertParticipant(conversationId, user.id);
    if (!participant) return forbidden();

    const conversation = await db.conversation.findUnique({
      where: { id: conversationId },
      select: { status: true },
    });
    if (conversation?.status === "BLOCKED") return forbidden();

    const { data, response: invalid } = await parseBody(req, sendMessageSchema);
    if (invalid) return invalid;

    const message = await sendMessage({
      conversationId,
      senderId: user.id,
      body: data.body,
      replyToId: data.replyToId,
    });

    // Drain the push outbox after the response is sent - never blocks the send.
    schedulePushDispatch();

    return created(message);
  });
}
