"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { byId, pickTemplate, type TaxonomyCategory } from "@/lib/discovery/taxonomy";
import { messageFromTemplate } from "@/lib/assistant";
import type { DiscoverProfile } from "@/lib/services/discovery";
import { cn } from "@/lib/utils";

/**
 * First-message composer for the swipe deck: message someone BEFORE
 * matching. The backend creates the Like alongside the message, so on
 * success the deck advances without calling /api/swipes.
 *
 * Mobile: bottom sheet (vaul drawer). Desktop (md+): centered dialog.
 * Every suggested opener is derived ONLY from real data - shared
 * taxonomy categories and the person's own prompt answer. No invention.
 */

const MAX_LENGTH = 280;

export type FirstMessageResult = { matched: boolean; conversationId?: string };

type Opener = { label: string; send: string };

/** Trim a prompt answer to a short, single-line excerpt. */
function excerptOf(answer: string, max = 56): string {
  const clean = answer.trim().replace(/\s+/g, " ");
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}...`;
}

/**
 * Up to 3 opener chips from REAL story data only:
 * - shared taxonomy categories' chatPromptTemplates (server sorts the
 *   ids strongest-first), template picked deterministically per pair
 *   (seeded viewerId + candidateId), rewritten ready-to-send via
 *   messageFromTemplate;
 * - the person's own prompt answer, quoted, turned into a question.
 * The prompt-tease chip earns a guaranteed slot when it exists.
 */
function openersFor(profile: DiscoverProfile, viewerId: string | null): Opener[] {
  const seedBase = `${viewerId ?? "viewer"}:${profile.userId}`;
  const fromCategories = profile.sharedCategoryIds
    .map((id) => byId.get(id))
    .filter((c): c is TaxonomyCategory => c != null)
    .map((cat): Opener | null => {
      const template = pickTemplate(cat.chatPromptTemplates, `${seedBase}:${cat.id}`);
      if (!template) return null;
      return { label: template.replace(/\.$/, ""), send: messageFromTemplate(template) };
    })
    .filter((o): o is Opener => o != null);

  const fromPrompt: Opener[] = [];
  if (profile.promptTease && profile.promptTease.answer.trim()) {
    const ex = excerptOf(profile.promptTease.answer);
    fromPrompt.push({
      label: `They said: "${ex}" - ask about it`,
      send: `You wrote "${ex}" - I need to hear more about that.`,
    });
  }

  const merged = fromPrompt.length
    ? [...fromCategories.slice(0, 2), ...fromPrompt, ...fromCategories.slice(2)]
    : fromCategories;

  const seen = new Set<string>();
  return merged
    .filter((o) => (seen.has(o.send) ? false : (seen.add(o.send), true)))
    .slice(0, 3);
}

/** md breakpoint - drawer below, dialog at and above. */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isDesktop;
}

export function FirstMessageSheet({
  profile,
  viewerId,
  reasonLine,
  open,
  onOpenChange,
  onSent,
}: {
  profile: DiscoverProfile | null;
  viewerId: string | null;
  /** ONE emotional line from real data - first server reason or goalLine. */
  reasonLine: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired on 201 - the deck confirms, advances and handles a match. */
  onSent: (result: FirstMessageResult) => void;
}) {
  const isDesktop = useIsDesktop();
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset the draft when the recipient changes (render-time reset on
  // prop change - the React-sanctioned pattern).
  const [prevId, setPrevId] = useState(profile?.userId);
  if (profile?.userId !== prevId) {
    setPrevId(profile?.userId);
    setBody("");
  }

  const openers = useMemo(
    () => (profile ? openersFor(profile, viewerId) : []),
    [profile, viewerId],
  );

  if (!profile) return null;

  const firstName = profile.displayName.split(" ")[0] || profile.displayName;
  const title = `First message to ${firstName}`;
  // Always real: server reason/goal line, or an honest product fact.
  const description = reasonLine ?? "They'll see your message with your like.";

  async function send() {
    if (!profile || pending || body.trim().length === 0) return;
    setPending(true);
    try {
      const res = await fetch("/api/first-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toId: profile.userId, body: body.trim() }),
      });
      if (res.status === 201) {
        const { data } = (await res.json()) as { data: FirstMessageResult };
        onSent({ matched: data.matched, conversationId: data.conversationId });
        return;
      }
      const payload = await res.json().catch(() => null);
      const message: string | undefined = payload?.error?.message;
      if (res.status === 409) {
        // Already messaged them - nothing to advance, just step aside
        toast(message ?? "You already sent them a message.");
        onOpenChange(false);
        return;
      }
      toast.error(
        message ??
          (res.status === 429
            ? "You've sent today's first messages. Try again tomorrow."
            : "Something went wrong. Try again."),
      );
      // Keep the sheet open - the draft is still theirs to send
    } catch {
      toast.error("You appear to be offline.");
    } finally {
      setPending(false);
    }
  }

  // The keyboard must never hide the composer: this block scrolls on its
  // own and the textarea always sits directly above the CTA footer.
  const composer = (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
      {openers.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Suggested openers">
          {openers.map((o) => (
            <button
              key={o.send}
              type="button"
              onClick={() => {
                setBody(o.send);
                textareaRef.current?.focus();
              }}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-left text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                body === o.send
                  ? "border-primary bg-primary/15 text-foreground"
                  : "border-border bg-foreground/5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
      <div className="space-y-1.5">
        <Textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, MAX_LENGTH))}
          maxLength={MAX_LENGTH}
          rows={3}
          autoFocus
          placeholder={`Something ${firstName} can actually reply to...`}
          aria-label={title}
          className="min-h-24"
          disabled={pending}
        />
        <p
          className="text-right text-[11px] tabular-nums text-muted-foreground"
          aria-live="polite"
        >
          {body.length}/{MAX_LENGTH}
        </p>
      </div>
    </div>
  );

  const sendButton = (
    <Button
      className="h-12 rounded-full"
      onClick={send}
      disabled={pending || body.trim().length === 0}
    >
      {pending ? "Sending..." : "Send with a like"}
    </Button>
  );
  const cancelButton = (
    <Button
      variant="ghost"
      className="rounded-full"
      onClick={() => onOpenChange(false)}
      disabled={pending}
    >
      Cancel
    </Button>
  );

  const focusComposer = (e: Event) => {
    e.preventDefault();
    textareaRef.current?.focus();
  };

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md" onOpenAutoFocus={focusComposer}>
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-medium">{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {composer}
          <div className="grid gap-2">
            {sendButton}
            {cancelButton}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        className="border-border bg-popover/95 backdrop-blur-2xl"
        onOpenAutoFocus={focusComposer}
      >
        <DrawerHeader className="pb-2">
          <DrawerTitle className="font-display text-2xl font-medium">{title}</DrawerTitle>
          <DrawerDescription>{description}</DrawerDescription>
        </DrawerHeader>
        <div className="flex min-h-0 flex-1 flex-col px-6">{composer}</div>
        <DrawerFooter className="gap-2 px-6 pb-[calc(1rem+var(--safe-bottom))]">
          {sendButton}
          {cancelButton}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
