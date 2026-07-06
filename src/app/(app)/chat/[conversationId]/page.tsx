import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertParticipant, markRead } from "@/lib/services/chat";
import { ChatThread, type ThreadMessage } from "@/components/app/chat-thread";
import { ChatActions } from "@/components/app/chat-actions";
import { OnlineDot } from "@/components/shared/online-dot";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { initialsOf } from "@/lib/utils";
import { isOnline as presenceOnline } from "@/lib/presence";

export const metadata: Metadata = { title: "Conversation" };
export const dynamic = "force-dynamic";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  const session = await auth();
  const userId = session!.user.id;

  const participant = await assertParticipant(conversationId, userId);
  if (!participant) notFound();

  const [other, messages] = await Promise.all([
    db.participant.findFirst({
      where: { conversationId, userId: { not: userId } },
      include: {
        user: {
          select: {
            id: true,
            lastActiveAt: true,
            profile: { select: { displayName: true } },
            photos: {
              orderBy: [{ isCover: "desc" }, { position: "asc" }],
              take: 1,
              select: { url: true },
            },
          },
        },
      },
    }),
    db.message.findMany({
      where: { conversationId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: { id: true, senderId: true, body: true, status: true, createdAt: true },
    }),
  ]);

  await markRead(conversationId, userId);

  const otherName = other?.user.profile?.displayName ?? "Member";
  const isOnline = other ? presenceOnline(other.user.lastActiveAt) : false;

  return (
    <>
      <header className="mb-2 flex items-center gap-3">
        <Button variant="ghost" size="icon" aria-label="Back to chats" className="rounded-full" asChild>
          <Link href="/chat">
            <ArrowLeft className="size-5" />
          </Link>
        </Button>
        <div className="relative">
          <Avatar className="size-10">
            <AvatarImage src={other?.user.photos[0]?.url} alt="" />
            <AvatarFallback>{initialsOf(otherName)}</AvatarFallback>
          </Avatar>
          <OnlineDot online={isOnline} className="absolute -bottom-0.5 -right-0.5" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-semibold">{otherName}</h1>
          <p className="text-xs text-muted-foreground">{isOnline ? "Online now" : "Recently active"}</p>
        </div>
        {other && <ChatActions otherUserId={other.user.id} otherName={otherName} />}
      </header>

      <ChatThread
        conversationId={conversationId}
        currentUserId={userId}
        otherName={otherName}
        initialMessages={messages as ThreadMessage[]}
      />
    </>
  );
}
