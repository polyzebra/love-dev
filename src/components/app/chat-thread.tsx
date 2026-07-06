"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, CheckCheck, SendHorizontal, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn, formatRelativeTime } from "@/lib/utils";

export type ThreadMessage = {
  id: string;
  senderId: string;
  body: string | null;
  status: "SENT" | "DELIVERED" | "SEEN";
  createdAt: string | Date;
  pending?: boolean;
};

const POLL_INTERVAL_MS = 5000;

export function ChatThread({
  conversationId,
  currentUserId,
  initialMessages,
  otherName,
}: {
  conversationId: string;
  currentUserId: string;
  initialMessages: ThreadMessage[];
  otherName: string;
}) {
  const [messages, setMessages] = useState<ThreadMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback((smooth = true) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "instant", block: "end" });
  }, []);

  useEffect(() => {
    scrollToBottom(false);
  }, [scrollToBottom]);

  // Poll for new messages — swap for WebSocket/SSE transport in production
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/conversations/${conversationId}/messages?take=50`);
        if (!res.ok) return;
        const { data } = (await res.json()) as { data: { messages: ThreadMessage[] } };
        setMessages((prev) => {
          const pending = prev.filter((m) => m.pending);
          const merged = [...data.messages, ...pending];
          const nearBottom =
            listRef.current &&
            listRef.current.scrollHeight - listRef.current.scrollTop - listRef.current.clientHeight < 120;
          if (merged.length !== prev.length && nearBottom) {
            requestAnimationFrame(() => scrollToBottom());
          }
          return merged;
        });
      } catch {
        // offline — polling will recover
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [conversationId, scrollToBottom]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;

    setSending(true);
    setDraft("");
    const optimistic: ThreadMessage = {
      id: `pending-${Date.now()}`,
      senderId: currentUserId,
      body,
      status: "SENT",
      createdAt: new Date(),
      pending: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    requestAnimationFrame(() => scrollToBottom());

    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) throw new Error();
      const { data } = (await res.json()) as { data: ThreadMessage };
      setMessages((prev) => prev.map((m) => (m.id === optimistic.id ? data : m)));
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setDraft(body);
      toast.error("Message didn't send. Check your connection.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-[calc(100dvh-180px)] flex-col lg:h-[calc(100dvh-160px)]">
      {/* Safety banner */}
      <div className="mb-3 flex items-center gap-2 rounded-2xl bg-accent px-4 py-2.5 text-xs text-accent-foreground">
        <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
        <p>
          Keep chats on Amora and never send money. Something feels off? Use Report in the menu
          above.
        </p>
      </div>

      {/* Messages */}
      <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto overscroll-contain pb-4" role="log" aria-label={`Conversation with ${otherName}`}>
        {messages.length === 0 && (
          <p className="pt-16 text-center text-sm text-muted-foreground">
            You matched with {otherName}. Say something worth replying to.
          </p>
        )}
        {messages.map((m, i) => {
          const mine = m.senderId === currentUserId;
          const prev = messages[i - 1];
          const showTime =
            !prev ||
            new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > 20 * 60_000;

          return (
            <div key={m.id}>
              {showTime && (
                <p className="py-2 text-center text-[11px] uppercase tracking-wide text-muted-foreground">
                  {formatRelativeTime(m.createdAt)}
                </p>
              )}
              <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[78%] rounded-3xl px-4 py-2.5 text-sm/relaxed",
                    mine
                      ? "rounded-br-lg bg-primary text-primary-foreground"
                      : "rounded-bl-lg bg-card shadow-card",
                    m.pending && "opacity-60",
                  )}
                >
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  {mine && (
                    <span
                      className="mt-0.5 flex justify-end"
                      aria-label={m.status === "SEEN" ? "Seen" : "Delivered"}
                    >
                      {m.status === "SEEN" ? (
                        <CheckCheck className="size-3.5 opacity-80" />
                      ) : (
                        <Check className="size-3.5 opacity-60" />
                      )}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <form
        className="flex items-end gap-2 border-t pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={`Message ${otherName}…`}
          aria-label={`Message ${otherName}`}
          rows={1}
          maxLength={2000}
          className="max-h-32 min-h-11 flex-1 resize-none rounded-3xl"
        />
        <Button
          type="submit"
          size="icon"
          aria-label="Send message"
          className="size-11 shrink-0 rounded-full"
          disabled={!draft.trim() || sending}
        >
          <SendHorizontal className="size-5" />
        </Button>
      </form>
    </div>
  );
}
