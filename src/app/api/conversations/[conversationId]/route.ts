import { forbidden, ok, parseBody, requireActiveAccount } from "@/lib/api";
import { conversationActionSchema } from "@/lib/validators/chat";
import { assertParticipant, markRead } from "@/lib/services/chat";
import { db } from "@/lib/db";

type Params = { params: Promise<{ conversationId: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const { conversationId } = await params;
  const { user, response } = await requireActiveAccount();
  if (response) return response;

  const participant = await assertParticipant(conversationId, user.id);
  if (!participant) return forbidden();

  const { data, response: invalid } = await parseBody(req, conversationActionSchema);
  if (invalid) return invalid;

  const where = { conversationId_userId: { conversationId, userId: user.id } };

  switch (data.action) {
    case "pin":
      await db.participant.update({ where, data: { isPinned: true } });
      break;
    case "unpin":
      await db.participant.update({ where, data: { isPinned: false } });
      break;
    case "archive":
      await db.participant.update({ where, data: { isArchived: true } });
      break;
    case "unarchive":
      await db.participant.update({ where, data: { isArchived: false } });
      break;
    case "mute":
      await db.participant.update({ where, data: { isMuted: true } });
      break;
    case "unmute":
      await db.participant.update({ where, data: { isMuted: false } });
      break;
    case "read":
      await markRead(conversationId, user.id);
      break;
  }

  return ok({ done: true });
}
