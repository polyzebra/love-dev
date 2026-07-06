import { apiError, created, ok, parseBody, requireSession } from "@/lib/api";
import { blockSchema } from "@/lib/validators/safety";
import { db } from "@/lib/db";
import { orderPair } from "@/lib/services/matching";

export async function POST(req: Request) {
  const { user, response } = await requireSession();
  if (response) return response;

  const { data, response: invalid } = await parseBody(req, blockSchema);
  if (invalid) return invalid;

  if (data.blockedId === user.id) {
    return apiError(400, "invalid_target", "You cannot block yourself.");
  }

  const [userAId, userBId] = orderPair(user.id, data.blockedId);

  await db.$transaction(async (tx) => {
    await tx.block.upsert({
      where: { blockerId_blockedId: { blockerId: user.id, blockedId: data.blockedId } },
      create: { blockerId: user.id, blockedId: data.blockedId },
      update: {},
    });

    // Close any active match & freeze the conversation
    const match = await tx.match.findUnique({
      where: { userAId_userBId: { userAId, userBId } },
      include: { conversation: { select: { id: true } } },
    });
    if (match) {
      await tx.match.update({
        where: { id: match.id },
        data: { status: "UNMATCHED", closedAt: new Date() },
      });
      if (match.conversation) {
        await tx.conversation.update({
          where: { id: match.conversation.id },
          data: { status: "BLOCKED" },
        });
      }
    }
  });

  return created({ blocked: true });
}

export async function GET() {
  const { user, response } = await requireSession();
  if (response) return response;

  const blocks = await db.block.findMany({
    where: { blockerId: user.id },
    include: {
      blocked: {
        select: { id: true, profile: { select: { displayName: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return ok(
    blocks.map((b) => ({
      userId: b.blockedId,
      displayName: b.blocked.profile?.displayName ?? "Member",
      blockedAt: b.createdAt,
    })),
  );
}
