"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PhotoFrame, type FramePhoto } from "@/components/shared/photo-frame";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { initialsOf } from "@/lib/utils";

/**
 * Serializable card model - the matches page (server) computes the
 * one REAL shared-reason line from the taxonomy and truncates the
 * preview; this component only renders and responds.
 */
export type FirstMessageCardData = {
  /** FirstMessage id - the respond endpoint's [id]. */
  id: string;
  senderName: string;
  senderAge: number | null;
  senderCity: string | null;
  photo: FramePhoto | null;
  /** One-line message preview, pre-truncated (~90 chars). */
  preview: string;
  /** Taxonomy shared-reason line, or the sender's goal line - never invented. */
  reason: string;
};

type RespondAction = "accept" | "decline";

async function respondRequest(id: string, action: RespondAction) {
  const res = await fetch(`/api/first-messages/${id}/respond`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  return res;
}

/**
 * "Messages waiting for you" - pending first messages on the matches
 * page. This is where the '<Name> sent you a message' notification's
 * story completes: read the opener, then Like back or Pass.
 *
 * Optimistic: the card leaves on tap; a failed request restores it in
 * place with the server's message. Accept lands in the new conversation.
 */
export function FirstMessageInbox({ initialItems }: { initialItems: FirstMessageCardData[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);

  if (items.length === 0) return null;

  const restore = (card: FirstMessageCardData, index: number) =>
    setItems((prev) => {
      if (prev.some((i) => i.id === card.id)) return prev;
      const next = [...prev];
      next.splice(Math.min(index, next.length), 0, card);
      return next;
    });

  const respond = async (card: FirstMessageCardData, action: RespondAction) => {
    const index = items.findIndex((i) => i.id === card.id);
    setItems((prev) => prev.filter((i) => i.id !== card.id));

    try {
      const res = await respondRequest(card.id, action);
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        restore(card, index);
        toast.error(payload?.error?.message ?? "Something went wrong. Try again.");
        return;
      }
      if (action === "accept") {
        const { data } = (await res.json()) as {
          data: { matched: boolean; conversationId?: string };
        };
        toast.success("It's a match");
        // A fresh server render of the destination - no refresh() needed
        // on top (dynamic routes carry no client cache to invalidate).
        router.push(data.conversationId ? `/chat/${data.conversationId}` : "/chat");
      }
      // Decline: local state already removed the card, and every other
      // page re-renders server-side on its next navigation anyway.
    } catch {
      restore(card, index);
      toast.error("You appear to be offline.");
    }
  };

  return (
    <section aria-labelledby="first-messages-heading" className="mb-8">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 id="first-messages-heading" className="font-display text-xl font-medium tracking-tight">
          Messages waiting for you
        </h2>
        <span className="text-sm text-muted-foreground" aria-hidden="true">
          {items.length}
        </span>
      </div>
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <AnimatePresence initial={false}>
          {items.map((card) => (
            <motion.li
              key={card.id}
              layout
              exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.18 } }}
            >
              <article
                aria-label={`First message from ${card.senderName}`}
                className="flex h-full gap-4 rounded-3xl border bg-card p-4 shadow-card"
              >
                <div className="w-24 shrink-0 self-start">
                  <PhotoFrame
                    photo={card.photo}
                    alt={`${card.senderName}'s photo`}
                    variant="thumb"
                    loading="lazy"
                    radius="none"
                    className="rounded-2xl bg-muted"
                    fallback={
                      <div className="flex h-full items-center justify-center">
                        <Avatar className="size-12">
                          <AvatarFallback>{initialsOf(card.senderName)}</AvatarFallback>
                        </Avatar>
                      </div>
                    }
                  />
                </div>

                <div className="flex min-w-0 flex-1 flex-col">
                  <p
                    className="truncate text-base font-semibold"
                    title={`${card.senderName}${card.senderAge != null ? `, ${card.senderAge}` : ""}`}
                  >
                    {card.senderName}
                    {card.senderAge != null ? `, ${card.senderAge}` : ""}
                    {card.senderCity && (
                      <span className="font-normal text-muted-foreground"> · {card.senderCity}</span>
                    )}
                  </p>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    &ldquo;{card.preview}&rdquo;
                  </p>
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-primary">
                    <Sparkles className="size-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{card.reason}</span>
                  </p>

                  <div className="mt-auto flex gap-2 pt-3">
                    <Button
                      className="h-11 min-w-0 flex-1 rounded-full"
                      aria-label={`Like ${card.senderName} back`}
                      onClick={() => respond(card, "accept")}
                    >
                      Like back
                    </Button>
                    <Button
                      variant="outline"
                      className="h-11 min-w-0 flex-1 rounded-full"
                      aria-label={`Pass on ${card.senderName}`}
                      onClick={() => respond(card, "decline")}
                    >
                      Pass
                    </Button>
                  </div>
                </div>
              </article>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </section>
  );
}
