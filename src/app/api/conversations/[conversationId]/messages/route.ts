import { apiError, forbidden, guardRate, created, ok, requireSession } from "@/lib/api";
import { canEngage, sweepExpiredRestrictions } from "@/lib/services/trust-safety";
import { parseBody } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { sendMessageSchema } from "@/lib/validators/chat";
import { assertParticipant, markRead, sendMessage } from "@/lib/services/chat";
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

  const messages = await db.message.findMany({
    where: { conversationId, deletedAt: null },
    include: {
      replyTo: { select: { id: true, body: true, senderId: true } },
      attachments: true,
    },
    orderBy: { createdAt: "desc" },
    take,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  await markRead(conversationId, user.id);

  return ok({
    messages: messages.reverse(),
    nextCursor: messages.length === take ? messages[0]?.id : null,
  });
}

export async function POST(req: Request, { params }: Params) {
  const { conversationId } = await params;
  const { user, response } = await requireSession();
  if (response) return response;

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
}
