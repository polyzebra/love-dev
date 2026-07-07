import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquareDashed, Pin } from "lucide-react";
import { requireUser } from "@/lib/auth/require-user";
import { listConversations } from "@/lib/services/chat";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { OnlineDot } from "@/components/shared/online-dot";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatRelativeTime, initialsOf } from "@/lib/utils";

export const metadata: Metadata = { title: "Chat" };
export const dynamic = "force-dynamic";

export default async function ChatListPage() {
  const user = await requireUser();
  const conversations = await listConversations(user.id);

  if (conversations.length === 0) {
    return (
      <>
        <PageHeader title="Chat" description="Conversations with your matches." />
        <EmptyState
          icon={MessageSquareDashed}
          title="No conversations yet"
          description="When you match with someone, your conversation starts here. A good opener beats 'hey' every time."
          action={
            <Button className="rounded-full" asChild>
              <Link href="/discover">Find your match</Link>
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Chat" description="Conversations with your matches." />
      <ul className="space-y-1">
        {conversations.map((c) => (
          <li key={c.conversationId}>
            <Link
              href={`/chat/${c.conversationId}`}
              className="flex items-center gap-4 rounded-3xl p-3 transition-colors hover:bg-card hover:shadow-card"
            >
              <div className="relative shrink-0">
                <Avatar className="size-14">
                  <AvatarImage src={c.other?.photo?.url} alt="" />
                  <AvatarFallback>{initialsOf(c.other?.displayName ?? "?")}</AvatarFallback>
                </Avatar>
                <OnlineDot
                  online={c.other?.isOnline ?? false}
                  className="absolute bottom-0.5 right-0.5"
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium">{c.other?.displayName ?? "Member"}</p>
                  {c.isPinned && <Pin className="size-3.5 text-muted-foreground" aria-label="Pinned" />}
                  {c.lastMessage && (
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {formatRelativeTime(c.lastMessage.createdAt)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <p
                    className={cn(
                      "truncate text-sm",
                      c.unread > 0 ? "font-medium text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {c.lastMessage?.body ?? "You matched - say hello!"}
                  </p>
                  {c.unread > 0 && (
                    <Badge className="ml-auto size-5 shrink-0 justify-center rounded-full p-0 text-[11px]">
                      {c.unread > 9 ? "9+" : c.unread}
                    </Badge>
                  )}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
