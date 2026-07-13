"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import {
  Check,
  CheckCheck,
  Clock,
  Coffee,
  ImageIcon,
  Mic,
  Plus,
  Quote,
  SendHorizontal,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { assistant, type Suggestion } from "@/lib/assistant";
import { emitInteraction } from "@/lib/interaction-events";
import { DURATIONS, SPRING, standardEase } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn, formatRelativeTime } from "@/lib/utils";
import {
  applyReceipt,
  confirmPending,
  mergeMessages,
  type ThreadMessage,
} from "@/lib/chat/thread-store";
import { useConversationChannel } from "@/components/app/use-conversation-channel";

export type { ThreadMessage } from "@/lib/chat/thread-store";

const HEARTBEAT_INTERVAL_MS = 10_000;
const METRICS_FLUSH_INTERVAL_MS = 60_000;
const GROUP_WINDOW_MS = 3 * 60_000;

/** Chip icon per suggestion kind. */
const KIND_ICON: Record<Suggestion["kind"], typeof Sparkles> = {
  opener: Sparkles,
  "follow-up": Clock,
  "next-step": Coffee,
};

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
  sharedCategoryIds = [],
  sharedInterests = [],
  theirPrompts = [],
  theyAreOnline = false,
  initialDraft = "",
}: {
  conversationId: string;
  currentUserId: string;
  initialMessages: ThreadMessage[];
  otherName: string;
  /** Taxonomy category ids both people belong to - drives cold-open openers. */
  sharedCategoryIds?: string[];
  sharedInterests?: string[];
  theirPrompts?: { key: string; label: string; answer: string }[];
  theyAreOnline?: boolean;
  /** Prefill for the composer, e.g. from a ?suggest= link. */
  initialDraft?: string;
}) {
  const [messages, setMessages] = useState<ThreadMessage[]>(initialMessages);
  const [draft, setDraft] = useState(initialDraft);
  const [sending, setSending] = useState(false);

  // The assistant is the single source of conversation suggestions.
  // Message meta is derived live from the thread so chips stay honest
  // as the conversation moves.
  const suggestions = useMemo(() => {
    const settled = messages.filter((m) => !m.pending);
    const last = settled[settled.length - 1] ?? null;
    return assistant.suggest({
      sharedCategoryIds,
      sharedInterests,
      theirName: otherName,
      theirPrompts,
      lastMessageAt: last ? new Date(last.createdAt) : null,
      lastMessageFromMe: last ? last.senderId === currentUserId : null,
      messageCount: settled.length,
      theyAreOnline,
    });
  }, [
    messages,
    sharedCategoryIds,
    sharedInterests,
    otherName,
    theirPrompts,
    currentUserId,
    theyAreOnline,
  ]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback((smooth = true) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "instant", block: "end" });
  }, []);

  useEffect(() => {
    scrollToBottom(false);
  }, [scrollToBottom]);

  // Presence heartbeat - tells the server this conversation is on
  // screen so the other side's "online" and read states stay honest.
  useEffect(() => {
    const beat = () => {
      if (document.visibilityState !== "visible") return;
      try {
        void fetch("/api/presence/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId }),
        }).catch(() => undefined);
      } catch {
        // Never let presence take down the thread.
      }
    };
    beat();
    const timer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [conversationId]);

  // ---- Realtime transport (Phase 0G) --------------------------------------
  // Supabase Realtime private channel is the delivery layer; PostgreSQL
  // stays the source of truth. Every event and every recovery fetch goes
  // through the same dedupe/order/no-regress rules (lib/chat/thread-store).
  // Transport health metrics are batched to /api/analytics - counters
  // only, never message content or ids.
  const metrics = useRef({
    deliveries: 0,
    latencySumMs: 0,
    latencyMaxMs: 0,
    duplicates: 0,
    recovered: 0,
    reconnects: 0,
    reconnectSumMs: 0,
    degradedFetches: 0,
  });

  useEffect(() => {
    const flush = (beacon: boolean) => {
      const m = metrics.current;
      if (m.deliveries + m.duplicates + m.recovered + m.reconnects + m.degradedFetches === 0) {
        return;
      }
      const payload = JSON.stringify({ name: "chat_transport", data: { ...m } });
      metrics.current = {
        deliveries: 0,
        latencySumMs: 0,
        latencyMaxMs: 0,
        duplicates: 0,
        recovered: 0,
        reconnects: 0,
        reconnectSumMs: 0,
        degradedFetches: 0,
      };
      try {
        if (beacon && navigator.sendBeacon) {
          navigator.sendBeacon("/api/analytics", new Blob([payload], { type: "application/json" }));
        } else {
          void fetch("/api/analytics", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
          }).catch(() => undefined);
        }
      } catch {
        // Metrics must never affect the thread.
      }
    };
    const timer = setInterval(() => flush(false), METRICS_FLUSH_INTERVAL_MS);
    const onHide = () => flush(true);
    window.addEventListener("pagehide", onHide);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", onHide);
      flush(true);
    };
  }, [conversationId]);

  const maybeFollowBottom = useCallback(
    (grew: boolean) => {
      const nearBottom =
        listRef.current &&
        listRef.current.scrollHeight - listRef.current.scrollTop - listRef.current.clientHeight <
          120;
      if (grew && nearBottom) requestAnimationFrame(() => scrollToBottom());
    },
    [scrollToBottom],
  );

  // Recipient-side receipts: "delivered" the moment a message reaches this
  // device, "read" while the thread is actually on screen. Both are
  // idempotent server-side and only broadcast on real state changes.
  const sendReceipt = useCallback(
    (kind: "delivered" | "read") => {
      try {
        void fetch(`/api/conversations/${conversationId}/receipts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind }),
        }).catch(() => undefined);
      } catch {
        // Receipts must never take down the thread.
      }
    },
    [conversationId],
  );

  const mergeIncoming = useCallback(
    (incoming: ThreadMessage[], source: "realtime" | "recovery" | "degraded") => {
      setMessages((prev) => {
        const out = mergeMessages(prev, incoming);
        if (source === "realtime") {
          metrics.current.duplicates += out.duplicateCount;
        } else {
          // Rows a recovery fetch found that realtime never delivered.
          metrics.current.recovered += out.addedIds.length;
          if (source === "degraded") metrics.current.degradedFetches += 1;
        }
        const fromOthers = out.addedIds.length > 0;
        if (fromOthers) {
          sendReceipt(document.visibilityState === "visible" ? "read" : "delivered");
        }
        maybeFollowBottom(out.messages.length !== prev.length);
        return out.messages;
      });
    },
    [maybeFollowBottom, sendReceipt],
  );

  const recover = useCallback(
    async (reason: "subscribe" | "visibility" | "degraded") => {
      try {
        const res = await fetch(`/api/conversations/${conversationId}/messages?take=50`);
        if (!res.ok) return;
        const { data } = (await res.json()) as { data: { messages: ThreadMessage[] } };
        mergeIncoming(data.messages, reason === "degraded" ? "degraded" : "recovery");
      } catch {
        // Offline - the next reconnect/visibility recovery will catch up.
      }
    },
    [conversationId, mergeIncoming],
  );

  useConversationChannel({
    conversationId,
    onBroadcast: (event, payload) => {
      if (event === "message:new") {
        const serverTs = typeof payload.serverTs === "number" ? payload.serverTs : null;
        if (serverTs) {
          const latency = Math.max(0, Date.now() - serverTs);
          metrics.current.deliveries += 1;
          metrics.current.latencySumMs += latency;
          metrics.current.latencyMaxMs = Math.max(metrics.current.latencyMaxMs, latency);
        }
        mergeIncoming([payload as unknown as ThreadMessage], "realtime");
      } else if (event === "receipt") {
        const receipt = payload as { kind?: "delivered" | "read"; byId?: string };
        if (receipt.kind && receipt.byId && receipt.byId !== currentUserId) {
          setMessages((prev) => applyReceipt(prev, { kind: receipt.kind!, byId: receipt.byId! }));
        }
      }
    },
    onRecover: (reason) => void recover(reason),
    onReconnectMeasured: (ms) => {
      metrics.current.reconnects += 1;
      metrics.current.reconnectSumMs += ms;
    },
  });

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
      // The confirmed message never re-animates (isNew stays unset) - it
      // visually IS the optimistic bubble settling, not a new arrival.
      // Realtime may have delivered the confirmed message while the POST
      // was in flight - confirmPending swaps the optimistic bubble out and
      // dedupes by id so no race can ever show the message twice.
      setMessages((prev) => confirmPending(prev, optimistic.id, data));
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
        className="flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-1 pt-2 pb-4"
        role="log"
        aria-label={`Conversation with ${otherName}`}
      >
        {/* Quiet safety line - present, not shouting */}
        <p className="text-muted-foreground flex items-center justify-center gap-1.5 pt-2 pb-6 text-center text-[11px]">
          <ShieldCheck className="size-3" aria-hidden="true" />
          Keep chats here and never send money ·{" "}
          <span className="underline underline-offset-2">Report</span> anything off
        </p>

        {isOpening && (
          <div className="flex flex-col items-center gap-4 pt-12 text-center">
            <span className="glass-chip flex size-14 items-center justify-center rounded-full">
              <Sparkles className="text-gold size-6" aria-hidden="true" />
            </span>
            <div>
              <p className="font-display text-xl">You matched with {otherName}</p>
              <p className="text-muted-foreground mt-1 text-sm">
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
          // Pending sends and polled-in arrivals animate; the history that
          // was already on screen at mount renders settled.
          const isNewArrival = Boolean(m.pending || m.isNew);

          return (
            <div key={m.id} className={cn(pos === "first" || pos === "solo" ? "pt-3" : "pt-0.5")}>
              {showTime && (
                <p className="text-muted-foreground py-3 text-center text-[10px] font-medium tracking-[0.2em] uppercase">
                  {formatRelativeTime(m.createdAt)}
                </p>
              )}
              <motion.div
                initial={isNewArrival ? { opacity: 0, y: 8 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: DURATIONS.standard, ease: standardEase }}
                className={cn("flex", mine ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[78%] px-4 py-2.5 text-sm/relaxed",
                    mine
                      ? "to-brand-hover text-primary-foreground bg-linear-160 from-[#f43f5e] shadow-[0_4px_16px_color-mix(in_srgb,var(--primary)_25%,transparent)]"
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
                  <p className="break-words whitespace-pre-wrap">{m.body}</p>
                </div>
              </motion.div>
              {isLastMine && (
                /* Honest transport states only: the backend stamps SENT on
                   create and SEEN via markRead - "Delivered" renders only
                   if a realtime transport ever sets it. While the POST is
                   in flight the bubble says so instead of claiming SENT. */
                <p className="text-muted-foreground flex items-center justify-end gap-1 pt-1 pr-2 text-[10px]">
                  {m.pending ? (
                    <>
                      Sending <Clock className="size-3" aria-hidden="true" />
                    </>
                  ) : m.status === "SEEN" ? (
                    <>
                      Seen <CheckCheck className="text-primary-soft size-3" aria-hidden="true" />
                    </>
                  ) : m.status === "DELIVERED" ? (
                    <>
                      Delivered <CheckCheck className="size-3" aria-hidden="true" />
                    </>
                  ) : (
                    <>
                      Sent <Check className="size-3" aria-hidden="true" />
                    </>
                  )}
                </p>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Assistant suggestions - honest chips derived from real context.
          Tapping inserts the ready-to-send text; nothing is auto-sent. */}
      {suggestions.length > 0 && (
        <div
          className="flex scrollbar-none gap-2 overflow-x-auto pb-2.5"
          aria-label="Conversation suggestions"
        >
          {suggestions.map((s) => {
            // Quote chips repeat their own words back - inspiration, not
            // validation: quote mark + italic muted text, no accent.
            const Icon = s.quote ? Quote : KIND_ICON[s.kind];
            const iconClass = s.quote ? "size-3.5 text-muted-foreground" : "size-3.5 text-gold";
            const chipClass = cn(
              "glass-chip tap-target flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium",
              s.quote ? "italic text-muted-foreground" : "text-foreground/90",
            );
            return (
              <motion.div
                key={`${s.kind}:${s.text}`}
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={SPRING.snappy}
                className="shrink-0"
              >
                {s.send ? (
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(s.send ?? "");
                      inputRef.current?.focus();
                    }}
                    className={cn(chipClass, "transition-transform active:scale-95")}
                  >
                    <Icon className={iconClass} aria-hidden="true" />
                    {s.text}
                  </button>
                ) : (
                  /* No canned line to offer - the chip is a gentle note */
                  <p role="note" className={chipClass}>
                    <Icon className={iconClass} aria-hidden="true" />
                    {s.text}
                  </p>
                )}
              </motion.div>
            );
          })}
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
          ref={inputRef}
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
