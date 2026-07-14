import { db } from "@/lib/db";
import { notifyUser } from "@/lib/services/notify";
import { broadcastToConversation } from "@/lib/services/realtime";

/**
 * Chat service. Persistence and access control live here; Supabase
 * Realtime (services/realtime.ts) is the delivery layer - every write
 * lands in PostgreSQL first, then best-effort broadcasts to the
 * conversation's private channel. A lost broadcast costs a recovery
 * fetch, never a message.
 */

export async function assertParticipant(conversationId: string, userId: string) {
  const participant = await db.participant.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  return participant;
}

export async function listConversations(userId: string) {
  const participants = await db.participant.findMany({
    where: { userId, isArchived: false },
    include: {
      conversation: {
        include: {
          participants: {
            where: { userId: { not: userId } },
            include: {
              user: {
                select: {
                  id: true,
                  lastActiveAt: true,
                  profile: { select: { displayName: true } },
                  photos: {
                    where: { isCover: true },
                    take: 1,
                    select: { url: true, blurDataUrl: true },
                  },
                },
              },
            },
          },
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { body: true, type: true, senderId: true, createdAt: true },
          },
        },
      },
    },
    orderBy: [{ isPinned: "desc" }, { conversation: { lastMessageAt: "desc" } }],
  });

  return Promise.all(
    participants.map(async (p) => {
      const other = p.conversation.participants[0]?.user;
      const lastMessage = p.conversation.messages[0] ?? null;
      const unread = await db.message.count({
        where: {
          conversationId: p.conversationId,
          senderId: { not: userId },
          createdAt: p.lastReadAt ? { gt: p.lastReadAt } : undefined,
          deletedAt: null,
        },
      });
      return {
        conversationId: p.conversationId,
        isPinned: p.isPinned,
        isMuted: p.isMuted,
        unread,
        lastMessage,
        other: other
          ? {
              userId: other.id,
              displayName: other.profile?.displayName ?? "Member",
              photo: other.photos[0] ?? null,
              isOnline: Date.now() - other.lastActiveAt.getTime() < 5 * 60_000,
            }
          : null,
      };
    }),
  );
}

export async function sendMessage(params: {
  conversationId: string;
  senderId: string;
  body: string;
  replyToId?: string;
}) {
  const message = await db.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: {
        conversationId: params.conversationId,
        senderId: params.senderId,
        body: params.body,
        replyToId: params.replyToId,
        status: "SENT",
      },
      include: {
        replyTo: { select: { id: true, body: true, senderId: true } },
      },
    });
    await tx.conversation.update({
      where: { id: params.conversationId },
      data: { lastMessageAt: created.createdAt },
    });
    return created;
  });

  // Live delivery first (participants only - RLS-authorized private
  // channel). serverTs lets clients measure delivery latency honestly.
  await broadcastToConversation(params.conversationId, "message:new", {
    id: message.id,
    conversationId: params.conversationId,
    senderId: message.senderId,
    type: message.type,
    status: message.status,
    body: message.body,
    replyTo: message.replyTo,
    createdAt: message.createdAt.toISOString(),
    serverTs: Date.now(),
  });

  // Notify every other participant through the outbox. notifyUser itself
  // skips the sender (actorUserId), suppresses blocked pairs, respects the
  // pushMessages preference/quiet hours, and suppresses push while the
  // recipient is actively viewing this conversation. The per-message
  // dedupe key makes retried requests safe. Push copy never includes the
  // message body (see pushCopyFor) - the in-app row stays generic too.
  const [others, senderProfile] = await Promise.all([
    db.participant.findMany({
      where: { conversationId: params.conversationId, userId: { not: params.senderId } },
      select: { userId: true },
    }),
    db.profile.findUnique({
      where: { userId: params.senderId },
      select: { displayName: true },
    }),
  ]);
  const senderName = senderProfile?.displayName ?? "Someone";
  for (const other of others) {
    await notifyUser({
      userId: other.userId,
      type: "NEW_MESSAGE",
      title: "New message",
      body: `${senderName} sent you a message.`,
      url: `/chat/${params.conversationId}`,
      actorUserId: params.senderId,
      conversationId: params.conversationId,
      dedupeKey: `message:${message.id}:recipient:${other.userId}`,
      data: { messageId: message.id },
    });
  }

  return message;
}

/**
 * THE thread read model (Phase 0M): one place owns which messages are
 * visible (deletedAt null) and how they are ordered. The GET route and
 * the SSR page both consume this - the visibility rule lives nowhere else.
 */
export async function listThreadMessages(
  conversationId: string,
  opts: { take: number; cursor?: string | null } = { take: 50 },
) {
  const messages = await db.message.findMany({
    where: { conversationId, deletedAt: null },
    include: {
      replyTo: { select: { id: true, body: true, senderId: true } },
      attachments: true,
    },
    orderBy: { createdAt: "desc" },
    take: opts.take,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  return {
    // Chronological for rendering; nextCursor pages further back.
    messages: messages.reverse(),
    nextCursor: messages.length === opts.take ? messages[0]?.id : null,
  };
}

export async function markRead(conversationId: string, userId: string) {
  const at = new Date();
  const [, updated] = await db.$transaction([
    db.participant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { lastReadAt: at },
    }),
    db.message.updateMany({
      where: { conversationId, senderId: { not: userId }, status: { not: "SEEN" } },
      data: { status: "SEEN" },
    }),
  ]);
  // Only a state CHANGE is worth a live event - repeated reads are noise.
  if (updated.count > 0) {
    await broadcastToConversation(conversationId, "receipt", {
      kind: "read",
      conversationId,
      byId: userId,
      at: at.toISOString(),
    });
  }
  return updated.count;
}

/**
 * Recipient's device acknowledged receiving message(s): SENT -> DELIVERED
 * for everything the OTHER side sent. Never regresses SEEN (the where
 * clause targets SENT only), so late/out-of-order acks are harmless.
 */
export async function markDelivered(conversationId: string, userId: string) {
  const at = new Date();
  const updated = await db.message.updateMany({
    where: { conversationId, senderId: { not: userId }, status: "SENT" },
    data: { status: "DELIVERED" },
  });
  if (updated.count > 0) {
    await broadcastToConversation(conversationId, "receipt", {
      kind: "delivered",
      conversationId,
      byId: userId,
      at: at.toISOString(),
    });
  }
  return updated.count;
}
