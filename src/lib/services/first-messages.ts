import { db } from "@/lib/db";
import { canEngage, isDiscoverableStatus } from "@/lib/services/trust-safety";
import {
  FIRST_MESSAGE_LIMITS,
  FIRST_MESSAGE_MAX_LENGTH,
  FIRST_MESSAGE_TTL_DAYS,
} from "@/lib/constants";
import { orderPair, planTierOf } from "@/lib/services/matching";
import { notifyUser } from "@/lib/services/notify";
import { calculateAge } from "@/lib/utils";

/**
 * "Message before match": a first message rides along with a Like and waits
 * in the receiver's inbox until they accept (match + conversation), decline,
 * or it expires. Conversations are ONLY created on accept / mutual like -
 * the chat list reads Conversation/Participant rows, so pending first
 * messages can never leak into it.
 *
 * The "one active pair" rule is status-dependent (a declined pair may try
 * again later), so it cannot be a DB @@unique - it is enforced here with a
 * PENDING-pair check inside the send transaction.
 */

export class FirstMessageError extends Error {
  constructor(
    public readonly code:
      | "invalid_target"
      | "not_found"
      | "forbidden"
      | "blocked"
      | "not_receptive"
      | "invalid_body"
      | "content_rejected"
      | "already_pending"
      | "not_pending"
      | "limit_reached",
    message: string,
  ) {
    super(message);
    this.name = "FirstMessageError";
  }
}

/** HTTP status for each domain error code - kept here so routes stay thin. */
export const FIRST_MESSAGE_ERROR_STATUS: Record<FirstMessageError["code"], number> = {
  invalid_target: 400,
  invalid_body: 400,
  content_rejected: 400,
  forbidden: 403,
  blocked: 403,
  not_receptive: 403,
  not_found: 404,
  already_pending: 409,
  not_pending: 409,
  limit_reached: 429,
};

// ---------------------------------------------------------------------------
// Content guard - an honest, small-scale filter: a lowercase blocklist plus
// a link/spam heuristic. No AI, no fuzzy matching; obvious evasion will pass
// and human moderation (reports) remains the real safety net.
// ---------------------------------------------------------------------------

const BLOCKED_WORDS = [
  "bitch",
  "cunt",
  "faggot",
  "nigger",
  "slut",
  "whore",
  "onlyfans",
  "cashapp",
  "venmo",
  "paypal.me",
  "sugar daddy",
  "sugar baby",
  "escort",
] as const;

const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s]+|[a-z0-9-]+\.(?:com|net|org|io|ly|me|co)\b/gi;

/** Returns a human-readable rejection reason, or null when the body is fine. */
export function contentGuard(body: string): string | null {
  const lower = body.toLowerCase();
  for (const word of BLOCKED_WORDS) {
    if (lower.includes(word)) return "That message contains language we do not allow.";
  }

  const links = lower.match(URL_PATTERN) ?? [];
  if (links.length >= 2) return "First messages cannot contain multiple links.";
  if (links.length === 1) {
    // A lone link with no real sentence around it reads as spam.
    const withoutLink = lower.replace(URL_PATTERN, "").trim();
    if (withoutLink.length < 20) return "First messages cannot be just a link.";
  }

  // Same short token repeated many times (e.g. "hey hey hey hey hey ...").
  const tokens = lower.split(/\s+/).filter(Boolean);
  if (tokens.length >= 8 && new Set(tokens).size <= 2) {
    return "That message looks like spam.";
  }

  return null;
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export type SendFirstMessageResult =
  | { id: string; matched: false }
  | { id: string; matched: true; conversationId: string };

export async function firstMessagesRemainingToday(senderId: string): Promise<number> {
  const tier = await planTierOf(senderId);
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const sentToday = await db.firstMessage.count({
    where: { senderId, createdAt: { gte: since } },
  });
  return Math.max(0, FIRST_MESSAGE_LIMITS[tier] - sentToday);
}

export async function sendFirstMessage(
  senderId: string,
  receiverId: string,
  rawBody: string,
): Promise<SendFirstMessageResult> {
  if (senderId === receiverId) {
    throw new FirstMessageError("invalid_target", "You cannot send a message to yourself.");
  }

  const body = rawBody.trim();
  if (body.length < 1 || body.length > FIRST_MESSAGE_MAX_LENGTH) {
    throw new FirstMessageError(
      "invalid_body",
      `Your message must be between 1 and ${FIRST_MESSAGE_MAX_LENGTH} characters.`,
    );
  }
  const rejection = contentGuard(body);
  if (rejection) throw new FirstMessageError("content_rejected", rejection);

  const [sender, receiver, block] = await Promise.all([
    db.user.findUnique({
      where: { id: senderId },
      select: {
        status: true,
        profile: { select: { displayName: true, gender: true, interestedIn: true } },
      },
    }),
    db.user.findUnique({
      where: { id: receiverId },
      select: {
        status: true,
        onboardingDone: true,
        profile: { select: { gender: true, interestedIn: true, isVisible: true } },
      },
    }),
    db.block.findFirst({
      where: {
        OR: [
          { blockerId: senderId, blockedId: receiverId },
          { blockerId: receiverId, blockedId: senderId },
        ],
      },
      select: { id: true },
    }),
  ]);

  // Engagement + visibility come from the trust-safety status ladder:
  // LIMITED/suspended/banned senders cannot start conversations; targets
  // stay reachable while their status is discoverable.
  if (!sender || !canEngage(sender.status) || !sender.profile) {
    throw new FirstMessageError("forbidden", "Your account cannot send messages right now.");
  }
  if (!receiver || !isDiscoverableStatus(receiver.status) || !receiver.profile) {
    throw new FirstMessageError("not_found", "This profile is no longer available.");
  }
  if (block) throw new FirstMessageError("blocked", "You cannot message this person.");
  if (!receiver.profile.isVisible || !receiver.onboardingDone) {
    throw new FirstMessageError("not_found", "This profile is no longer available.");
  }

  // Mutual gender-preference fit - the same predicate the discovery feed
  // applies (empty interestedIn means open to everyone).
  const senderOk =
    sender.profile.interestedIn.length === 0 ||
    sender.profile.interestedIn.includes(receiver.profile.gender);
  const receiverOk =
    receiver.profile.interestedIn.length === 0 ||
    receiver.profile.interestedIn.includes(sender.profile.gender);
  if (!senderOk || !receiverOk) {
    throw new FirstMessageError("not_receptive", "This person is outside your mutual preferences.");
  }

  const remaining = await firstMessagesRemainingToday(senderId);
  if (remaining <= 0) {
    throw new FirstMessageError("limit_reached", "You have used all of your first messages for today.");
  }

  const senderName = sender.profile.displayName;
  const preview = body.length > 120 ? `${body.slice(0, 117)}...` : body;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + FIRST_MESSAGE_TTL_DAYS * 24 * 3600 * 1000);

  return db.$transaction(async (tx) => {
    // One PENDING first message per pair, in either direction.
    const pending = await tx.firstMessage.findFirst({
      where: {
        status: "PENDING",
        OR: [
          { senderId, receiverId },
          { senderId: receiverId, receiverId: senderId },
        ],
      },
      select: { id: true },
    });
    if (pending) {
      throw new FirstMessageError("already_pending", "There is already a pending message between you two.");
    }

    // The first message always carries a Like; never duplicate or downgrade
    // an existing one (update: {} leaves a prior SUPER_LIKE untouched).
    await tx.like.upsert({
      where: { fromId_toId: { fromId: senderId, toId: receiverId } },
      create: { fromId: senderId, toId: receiverId, action: "LIKE" },
      update: {},
    });

    const reciprocal = await tx.like.findUnique({
      where: { fromId_toId: { fromId: receiverId, toId: senderId } },
      select: { action: true },
    });
    const isMutual = !!reciprocal && reciprocal.action !== "PASS";

    if (!isMutual) {
      const firstMessage = await tx.firstMessage.create({
        data: { senderId, receiverId, body, expiresAt },
        select: { id: true },
      });
      // Same in-app payload as before (preview included in-app only - push
      // copy for NEW_LIKE is always generic), now via the outbox.
      await notifyUser(
        {
          userId: receiverId,
          type: "NEW_LIKE",
          title: `${senderName} sent you a message`,
          body: preview,
          url: "/matches",
          actorUserId: senderId,
          dedupeKey: `first-message:${firstMessage.id}:receiver:${receiverId}`,
          data: { firstMessageId: firstMessage.id, senderId, preview },
        },
        { client: tx },
      );
      return { id: firstMessage.id, matched: false as const };
    }

    // They already liked the sender - skip the waiting room entirely:
    // match, open the conversation and deliver the body as its first message.
    const firstMessage = await tx.firstMessage.create({
      data: { senderId, receiverId, body, status: "ACCEPTED", acceptedAt: now, expiresAt },
      select: { id: true },
    });

    const [userAId, userBId] = orderPair(senderId, receiverId);
    const match = await tx.match.upsert({
      where: { userAId_userBId: { userAId, userBId } },
      create: {
        userAId,
        userBId,
        conversation: {
          create: { participants: { create: [{ userId: userAId }, { userId: userBId }] } },
        },
      },
      update: { status: "ACTIVE", closedAt: null },
      include: { conversation: { select: { id: true } } },
    });

    let conversationId = match.conversation?.id;
    if (!conversationId) {
      const conversation = await tx.conversation.create({
        data: {
          matchId: match.id,
          participants: { create: [{ userId: userAId }, { userId: userBId }] },
        },
        select: { id: true },
      });
      conversationId = conversation.id;
    }

    const message = await tx.message.create({
      data: { conversationId, senderId, body, status: "SENT" },
      select: { createdAt: true },
    });
    await tx.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: message.createdAt },
    });

    for (const [userId, actorUserId] of [
      [senderId, receiverId],
      [receiverId, senderId],
    ] as const) {
      await notifyUser(
        {
          userId,
          type: "NEW_MATCH",
          title: "It's a match!",
          body: "You liked each other. Say hello 👋",
          url: `/chat/${conversationId}`,
          actorUserId,
          dedupeKey: `match:${match.id}:user:${userId}`,
          data: { matchId: match.id, conversationId },
        },
        { client: tx },
      );
    }

    return { id: firstMessage.id, matched: true as const, conversationId };
  });
}

// ---------------------------------------------------------------------------
// Respond
// ---------------------------------------------------------------------------

export type RespondResult =
  | { status: "ACCEPTED"; conversationId: string }
  | { status: "DECLINED" };

export async function respondToFirstMessage(
  receiverId: string,
  firstMessageId: string,
  action: "accept" | "decline",
): Promise<RespondResult> {
  const firstMessage = await db.firstMessage.findUnique({
    where: { id: firstMessageId },
    include: { sender: { select: { profile: { select: { displayName: true } } } } },
  });
  if (!firstMessage) throw new FirstMessageError("not_found", "This message no longer exists.");
  if (firstMessage.receiverId !== receiverId) {
    throw new FirstMessageError("forbidden", "Only the receiver can respond to this message.");
  }
  if (firstMessage.status !== "PENDING") {
    throw new FirstMessageError("not_pending", "This message has already been handled.");
  }
  if (firstMessage.expiresAt && firstMessage.expiresAt < new Date()) {
    await db.firstMessage.update({
      where: { id: firstMessage.id },
      data: { status: "EXPIRED" },
    });
    throw new FirstMessageError("not_pending", "This message has expired.");
  }

  if (action === "decline") {
    // Declined rows simply drop out of the PENDING-only inbox listing;
    // the sender is never notified of a decline.
    await db.firstMessage.update({
      where: { id: firstMessage.id },
      data: { status: "DECLINED", declinedAt: new Date() },
    });
    return { status: "DECLINED" };
  }

  const senderId = firstMessage.senderId;
  const senderName = firstMessage.sender.profile?.displayName ?? "Someone";

  return db.$transaction(async (tx) => {
    // Accepting is a like back.
    await tx.like.upsert({
      where: { fromId_toId: { fromId: receiverId, toId: senderId } },
      create: { fromId: receiverId, toId: senderId, action: "LIKE" },
      update: {},
    });

    const [userAId, userBId] = orderPair(senderId, receiverId);
    const match = await tx.match.upsert({
      where: { userAId_userBId: { userAId, userBId } },
      create: {
        userAId,
        userBId,
        conversation: {
          create: { participants: { create: [{ userId: userAId }, { userId: userBId }] } },
        },
      },
      update: { status: "ACTIVE", closedAt: null },
      include: { conversation: { select: { id: true } } },
    });

    let conversationId = match.conversation?.id;
    if (!conversationId) {
      const conversation = await tx.conversation.create({
        data: {
          matchId: match.id,
          participants: { create: [{ userId: userAId }, { userId: userBId }] },
        },
        select: { id: true },
      });
      conversationId = conversation.id;
    }

    // The waiting first message becomes the conversation's opening message,
    // attributed to its original sender.
    const message = await tx.message.create({
      data: { conversationId, senderId, body: firstMessage.body, status: "SENT" },
      select: { createdAt: true },
    });
    await tx.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: message.createdAt },
    });

    await tx.firstMessage.update({
      where: { id: firstMessage.id },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    });

    await notifyUser(
      {
        userId: senderId,
        type: "NEW_MATCH",
        title: "It's a match!",
        body: "Your message landed. The conversation is open 👋",
        url: `/chat/${conversationId}`,
        actorUserId: receiverId,
        dedupeKey: `match:${match.id}:user:${senderId}`,
        data: { matchId: match.id, conversationId },
      },
      { client: tx },
    );
    await notifyUser(
      {
        userId: receiverId,
        type: "NEW_MATCH",
        title: "It's a match!",
        body: `You matched with ${senderName}. Say hello 👋`,
        url: `/chat/${conversationId}`,
        actorUserId: senderId,
        dedupeKey: `match:${match.id}:user:${receiverId}`,
        data: { matchId: match.id, conversationId },
      },
      { client: tx },
    );

    return { status: "ACCEPTED" as const, conversationId };
  });
}

// ---------------------------------------------------------------------------
// Inbox listing (Likes page)
// ---------------------------------------------------------------------------

export async function listFirstMessagesFor(receiverId: string) {
  const rows = await db.firstMessage.findMany({
    where: {
      receiverId,
      status: "PENDING",
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { createdAt: "desc" },
    include: {
      sender: {
        select: {
          id: true,
          profile: {
            select: {
              displayName: true,
              birthDate: true,
              city: true,
              relationshipGoal: true,
              availabilityTags: true,
              communityTags: true,
              interests: { select: { interest: { select: { slug: true } } } },
            },
          },
          photos: {
            where: { moderation: { not: "REJECTED" } },
            orderBy: [{ isCover: "desc" }, { position: "asc" }],
            take: 1,
            select: {
              url: true,
              blurDataUrl: true,
              thumbUrl: true,
              galleryUrl: true,
              fullUrl: true,
            },
          },
        },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    body: row.body,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    sender: {
      userId: row.sender.id,
      displayName: row.sender.profile?.displayName ?? "Member",
      age: row.sender.profile ? calculateAge(row.sender.profile.birthDate) : null,
      city: row.sender.profile?.city ?? null,
      photo: row.sender.photos[0] ?? null,
      relationshipGoal: row.sender.profile?.relationshipGoal ?? null,
      availabilityTags: row.sender.profile?.availabilityTags ?? [],
      communityTags: row.sender.profile?.communityTags ?? [],
      interestSlugs: row.sender.profile?.interests.map((i) => i.interest.slug) ?? [],
    },
  }));
}
