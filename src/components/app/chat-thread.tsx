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
  RefreshCcw,
  SendHorizontal,
  ShieldCheck,
  Sparkles,
  Wine,
  X,
} from "lucide-react";
import { emitInteraction } from "@/lib/interaction-events";
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

/**
 * Conversation intelligence - everything below derives from REAL shared
 * interests between the two people; nothing is invented.
 */
const STARTER_TEMPLATES: [RegExp, (name: string) => string][] = [
  [/hik/i, (n) => `You both love hiking - ask ${n} about a favourite trail`],
  [/coffee/i, (n) => `You both rate coffee - ask ${n} for their go-to café`],
  [/travel/i, (n) => `You both love travelling - ask ${n} their dream destination`],
  [/dog/i, (n) => `You're both dog people - ask about ${n}'s dog`],
  [/run/i, (n) => `You both run - ask ${n} about their route`],
  [/swim/i, (n) => `You both swim - ask ${n} where they brave the water`],
  [/read/i, (n) => `You both read - ask ${n} what they'd recommend`],
  [/music/i, (n) => `You both love live music - ask ${n} about the best gig they've seen`],
  [/cook|bak/i, (n) => `You both cook - ask ${n} their signature dish`],
  [/film/i, (n) => `You both love films - ask ${n} for a favourite`],
];

function startersFor(shared: string[], name: string): string[] {
  const out: string[] = [];
  for (const interest of shared) {
    const hit = STARTER_TEMPLATES.find(([re]) => re.test(interest));
    out.push(
      hit ? hit[1](name) : `You both love ${interest.toLowerCase()} - ask ${name} about it`,
    );
  }
  return out;
}

/** First-date ideas, personal ones (from shared ground) first. */
function dateIdeasFor(shared: string[]): { icon: typeof Coffee; label: string }[] {
  const personal: { icon: typeof Coffee; label: string }[] = [];
  const has = (re: RegExp) => shared.some((s) => re.test(s));
  if (has(/coffee/i)) personal.push({ icon: Coffee, label: "Coffee at a café you both rate?" });
  if (has(/hik|walk|run/i)) personal.push({ icon: Sparkles, label: "A walk somewhere green this weekend?" });
  if (has(/swim/i)) personal.push({ icon: Sparkles, label: "A sea swim, then breakfast?" });
  if (has(/read/i)) personal.push({ icon: Sparkles, label: "A bookshop wander?" });
  if (has(/music/i)) personal.push({ icon: Sparkles, label: "A gig this month?" });
  if (has(/dog/i)) personal.push({ icon: Sparkles, label: "A dog walk date?" });
  if (has(/food|bak|cook/i)) personal.push({ icon: Coffee, label: "Breakfast somewhere new?" });
  return [
    ...personal,
    { icon: Coffee, label: "Coffee this week?" },
    { icon: Wine, label: "Drinks on Friday?" },
  ];
}

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
  sharedInterests = [],
}: {
  conversationId: string;
  currentUserId: string;
  initialMessages: ThreadMessage[];
  otherName: string;
  sharedInterests?: string[];
}) {
  const [messages, setMessages] = useState<ThreadMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [ideaIndex, setIdeaIndex] = useState(0);
  const [nudgeDismissed, setNudgeDismissed] = useState(true);

  useEffect(() => {
    // A gentle, once-per-session suggestion - never on first paint
    setNudgeDismissed(
      window.sessionStorage.getItem(`virelsy:nudge:${conversationId}`) === "1",
    );
  }, [conversationId]);

  const firstName = otherName.split(" ")[0];
  const starters = startersFor(sharedInterests, firstName);
  const dateIdeas = dateIdeasFor(sharedInterests);
  const idea = dateIdeas[ideaIndex % dateIdeas.length];

  // The conversation has real back-and-forth: both people, enough said
  const bothTalking =
    new Set(messages.map((m) => m.senderId)).size >= 2 && messages.length >= 12;
  const showNudge = bothTalking && !nudgeDismissed;

  function dismissNudge() {
    setNudgeDismissed(true);
    window.sessionStorage.setItem(`virelsy:nudge:${conversationId}`, "1");
  }
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback((smooth = true) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "instant", block: "end" });
  }, []);

  useEffect(() => {
    scrollToBottom(false);
  }, [scrollToBottom]);

  // Poll for new messages - swap for WebSocket/SSE transport in production
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
        // offline - polling will recover
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
      emitInteraction("message-send");
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
        {/* Quiet safety line - present, not shouting */}
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

      {/* Guided moment - the right suggestion for where you are */}
      {showNudge ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 26 }}
          className="glass mb-2.5 flex items-center gap-3 rounded-3xl p-4"
          role="note"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/15">
            <Sparkles className="size-4.5 text-primary-soft" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">You two seem to have a lot in common.</p>
            <p className="text-xs text-muted-foreground">Maybe it&apos;s time to plan your first date.</p>
          </div>
          <Button
            size="sm"
            className="shrink-0 rounded-full"
            onClick={() => {
              setDraft(idea.label);
              dismissNudge();
            }}
          >
            Suggest it
          </Button>
          <button
            type="button"
            onClick={dismissNudge}
            aria-label="Dismiss suggestion"
            className="tap-target -mr-1 shrink-0 rounded-full p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </motion.div>
      ) : messages.length > 0 && messages.length < 8 && starters.length > 0 ? (
        /* Early conversation: openers built from real shared ground */
        <div className="scrollbar-none flex gap-2 overflow-x-auto pb-2.5" aria-label="Conversation starters">
          {starters.slice(0, 3).map((starter) => (
            <button
              key={starter}
              type="button"
              onClick={() => setDraft(starter.split(" - ")[1] ?? starter)}
              className="glass-chip tap-target flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium text-foreground/90 transition-transform active:scale-95"
            >
              <Sparkles className="size-3.5 text-gold" aria-hidden="true" />
              {starter}
            </button>
          ))}
        </div>
      ) : messages.length >= 8 && messages.length < 40 ? (
        /* Mid conversation: one date idea at a time, cycle at will */
        <div className="flex items-center gap-2 pb-2.5" aria-label="First date idea">
          <button
            type="button"
            onClick={() => setDraft(idea.label)}
            className="glass-chip tap-target flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium text-foreground/90 transition-transform active:scale-95"
          >
            <idea.icon className="size-3.5 text-gold" aria-hidden="true" />
            {idea.label}
          </button>
          <button
            type="button"
            onClick={() => setIdeaIndex((i) => i + 1)}
            aria-label="Another idea"
            className="tap-target rounded-full p-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <RefreshCcw className="size-3.5" />
          </button>
        </div>
      ) : null}

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
