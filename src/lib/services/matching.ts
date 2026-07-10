import { db } from "@/lib/db";
import { SWIPE_LIMITS } from "@/lib/constants";
import { notifyUser } from "@/lib/services/notify";
import type { PlanTier, SwipeAction } from "@/generated/prisma/enums";

/** Canonical ordering so a user pair maps to exactly one Match row. */
export function orderPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export async function planTierOf(userId: string): Promise<PlanTier> {
  const sub = await db.subscription.findUnique({ where: { userId } });
  if (!sub || sub.status !== "ACTIVE") return "FREE";
  return sub.tier;
}

export async function swipesRemainingToday(userId: string, tier: PlanTier) {
  const limits = SWIPE_LIMITS[tier];
  const since = new Date();
  since.setHours(0, 0, 0, 0);

  const [likes, superLikes] = await Promise.all([
    db.like.count({
      where: { fromId: userId, action: "LIKE", createdAt: { gte: since } },
    }),
    db.like.count({
      where: { fromId: userId, action: "SUPER_LIKE", createdAt: { gte: since } },
    }),
  ]);

  return {
    likes: limits.likesPerDay === Infinity ? Infinity : Math.max(0, limits.likesPerDay - likes),
    superLikes: Math.max(0, limits.superLikesPerDay - superLikes),
  };
}

export type SwipeOutcome = {
  matched: boolean;
  matchId?: string;
  conversationId?: string;
};

/**
 * Record a swipe. On mutual LIKE/SUPER_LIKE, atomically create the Match
 * and its Conversation with both participants.
 */
export async function recordSwipe(
  fromId: string,
  toId: string,
  action: SwipeAction,
): Promise<SwipeOutcome> {
  await db.like.upsert({
    where: { fromId_toId: { fromId, toId } },
    create: { fromId, toId, action },
    update: { action, createdAt: new Date() },
  });

  if (action === "PASS") return { matched: false };

  const reciprocal = await db.like.findUnique({
    where: { fromId_toId: { fromId: toId, toId: fromId } },
  });
  if (!reciprocal || reciprocal.action === "PASS") return { matched: false };

  const [userAId, userBId] = orderPair(fromId, toId);

  const match = await db.match.upsert({
    where: { userAId_userBId: { userAId, userBId } },
    create: {
      userAId,
      userBId,
      conversation: {
        create: {
          participants: {
            create: [{ userId: userAId }, { userId: userBId }],
          },
        },
      },
    },
    update: { status: "ACTIVE", closedAt: null },
    include: { conversation: { select: { id: true } } },
  });

  // Same in-app copy as before, but routed through the outbox so the match
  // also lands as a push (per prefs). The other user is the actor, so
  // block-suppression applies; the matchId-scoped dedupe key means a
  // re-swipe on an existing match never re-notifies.
  for (const [userId, actorUserId] of [
    [fromId, toId],
    [toId, fromId],
  ] as const) {
    await notifyUser({
      userId,
      type: "NEW_MATCH",
      title: "It's a match!",
      body: "You liked each other. Say hello 👋",
      url: match.conversation ? `/chat/${match.conversation.id}` : "/matches",
      actorUserId,
      dedupeKey: `match:${match.id}:user:${userId}`,
      data: {
        matchId: match.id,
        ...(match.conversation ? { conversationId: match.conversation.id } : {}),
      },
    });
  }

  return {
    matched: true,
    matchId: match.id,
    conversationId: match.conversation?.id,
  };
}

export async function undoLastSwipe(userId: string): Promise<boolean> {
  const last = await db.like.findFirst({
    where: { fromId: userId },
    orderBy: { createdAt: "desc" },
  });
  if (!last) return false;

  // Undo only if no match was formed from it
  const [a, b] = orderPair(userId, last.toId);
  const match = await db.match.findUnique({ where: { userAId_userBId: { userAId: a, userBId: b } } });
  if (match?.status === "ACTIVE") return false;

  await db.like.delete({ where: { id: last.id } });
  return true;
}
