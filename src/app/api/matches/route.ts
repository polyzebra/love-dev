import { ok, requireSession } from "@/lib/api";
import { db } from "@/lib/db";
import { calculateAge } from "@/lib/utils";

export async function GET() {
  const { user, response } = await requireSession();
  if (response) return response;

  const matches = await db.match.findMany({
    where: {
      status: "ACTIVE",
      OR: [{ userAId: user.id }, { userBId: user.id }],
    },
    include: {
      conversation: { select: { id: true, lastMessageAt: true } },
      userA: {
        select: {
          id: true,
          lastActiveAt: true,
          profile: { select: { displayName: true, birthDate: true } },
          photos: { where: { isCover: true }, take: 1, select: { url: true, blurDataUrl: true } },
        },
      },
      userB: {
        select: {
          id: true,
          lastActiveAt: true,
          profile: { select: { displayName: true, birthDate: true } },
          photos: { where: { isCover: true }, take: 1, select: { url: true, blurDataUrl: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const data = matches.map((m) => {
    const other = m.userAId === user.id ? m.userB : m.userA;
    return {
      matchId: m.id,
      conversationId: m.conversation?.id ?? null,
      matchedAt: m.createdAt,
      other: {
        userId: other.id,
        displayName: other.profile?.displayName ?? "Member",
        age: other.profile ? calculateAge(other.profile.birthDate) : null,
        photo: other.photos[0] ?? null,
        isOnline: Date.now() - other.lastActiveAt.getTime() < 5 * 60_000,
      },
    };
  });

  return ok(data);
}
