"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import {
  Check,
  CheckCheck,
  Coffee,
  ImageIcon,
  Mic,
  Plus,
  SendHorizontal,
  ShieldCheck,
  Sparkles,
  Wine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
const GROUP_WINDOW_MS = 3 * 60_000;

const DATE_IDEAS = [
  { icon: Coffee, label: "Coffee this week?" },
  { icon: Wine, label: "Drinks on Friday?" },
  { icon: Sparkles, label: "Surprise me — plan something" },
] as const;

/** Position of a message within a same-sender burst, for bubble shape. */
function positionIn(messages: ThreadMessage[], i: number): "solo" | "first" | "middle" | "last" {
  const m = messages[i];
  const prev = messages[i - 1];
  const nextM = messages[i + 1];
  const joinsPrev =
    prev &&
    prev.senderId === m.senderId &&
    new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_WINDOW_MS;
  const joinsNext =
    nextM &&
    nextM.senderId === m.senderId &&
    new Date(nextM.createdAt).getTime() - new Date(m.createdAt).getTime() < GROUP_WINDOW_MS;
  if (joinsPrev && joinsNext) return "middle";
  if (joinsPrev) return "last";
  if (joinsNext) return "first";
  return "solo";
}

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

  async function send(text?: string) {
    const body = (text ?? draft).trim();
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

  const isOpening = messages.length === 0;

  return (
    <div className="flex h-[calc(100dvh-190px)] flex-col lg:h-[calc(100dvh-170px)]">
      {/* Messages */}
      <div
        ref={listRef}
        className="flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-1 pb-4 pt-2"
        role="log"
        aria-label={`Conversation with ${otherName}`}
      >
        {/* Quiet safety line — present, not shouting */}
        <p className="flex items-center justify-center gap-1.5 pb-6 pt-2 text-center text-[11px] text-muted-foreground">
          <ShieldCheck className="size-3" aria-hidden="true" />
          Keep chats here and never send money ·{" "}
          <span className="underline underline-offset-2">Report</span> anything off
        </p>

        {isOpening && (
          <div className="flex flex-col items-center gap-4 pt-12 text-center">
            <span className="glass-chip flex size-14 items-center justify-center rounded-full">
              <Sparkles className="size-6 text-gold" aria-hidden="true" />
            </span>
            <div>
              <p className="font-display text-xl">You matched with {otherName}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Openers about their interests get replies. &ldquo;Hey&rdquo; doesn&apos;t.
              </p>
            </div>
          </div>
        )}

        {messages.map((m, i) => {
          const mine = m.senderId === currentUserId;
          const pos = positionIn(messages, i);
          const prev = messages[i - 1];
          const showTime =
            !prev ||
            new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > 20 * 60_000;
          const isLastMine = mine && i === messages.length - 1;

          return (
            <div key={m.id} className={cn(pos === "first" || pos === "solo" ? "pt-3" : "pt-0.5")}>
              {showTime && (
                <p className="py-3 text-center text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                  {formatRelativeTime(m.createdAt)}
                </p>
              )}
              <motion.div
                initial={{ opacity: 0, y: 14, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: "spring", stiffness: 420, damping: 30 }}
                className={cn("flex", mine ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[78%] px-4 py-2.5 text-sm/relaxed",
                    mine
                      ? "bg-linear-160 from-[#f43f5e] to-[#be123c] text-white shadow-[0_4px_16px_rgba(225,29,72,0.25)]"
                      : "glass text-foreground",
                    // Bubble geometry by position in the burst
                    mine
                      ? {
                          solo: "rounded-[22px] rounded-br-lg",
                          first: "rounded-[22px] rounded-br-md",
                          middle: "rounded-[22px] rounded-r-md",
                          last: "rounded-[22px] rounded-tr-md rounded-br-lg",
                        }[pos]
                      : {
                          solo: "rounded-[22px] rounded-bl-lg",
                          first: "rounded-[22px] rounded-bl-md",
                          middle: "rounded-[22px] rounded-l-md",
                          last: "rounded-[22px] rounded-tl-md rounded-bl-lg",
                        }[pos],
                    m.pending && "opacity-60",
                  )}
                >
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                </div>
              </motion.div>
              {isLastMine && (
                <p
                  className="flex items-center justify-end gap-1 pr-2 pt-1 text-[10px] text-muted-foreground"
                  aria-label={m.status === "SEEN" ? "Seen" : "Delivered"}
                >
                  {m.status === "SEEN" ? (
                    <>
                      Seen <CheckCheck className="size-3 text-primary-soft" />
                    </>
                  ) : (
                    <>
                      Delivered <Check className="size-3" />
                    </>
                  )}
                </p>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Date ideas — one tap starts a plan */}
      {messages.length > 0 && messages.length < 30 && (
        <div className="scrollbar-none flex gap-2 overflow-x-auto pb-2.5">
          {DATE_IDEAS.map(({ icon: Icon, label }) => (
            <button
              key={label}
              type="button"
              onClick={() => setDraft(label)}
              className="glass-chip tap-target flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium text-foreground/90 transition-transform active:scale-95"
            >
              <Icon className="size-3.5 text-gold" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Glass composer */}
      <form
        className="glass flex items-end gap-1.5 rounded-[26px] p-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Add attachment"
              className="size-11 shrink-0 rounded-full"
            >
              <Plus className="size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="rounded-2xl">
            <DropdownMenuItem onSelect={() => toast("Photos in chat are coming soon.")}>
              <ImageIcon className="size-4" /> Photo
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => toast("Voice notes are coming soon.")}>
              <Mic className="size-4" /> Voice note
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
          className="max-h-32 min-h-11 flex-1 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
        />
        <motion.div whileTap={{ scale: 0.85 }}>
          <Button
            type="submit"
            size="icon"
            aria-label="Send message"
            className="size-11 shrink-0 rounded-full"
            disabled={!draft.trim() || sending}
          >
            <SendHorizontal className="size-5" />
          </Button>
        </motion.div>
      </form>
    </div>
  );
}
