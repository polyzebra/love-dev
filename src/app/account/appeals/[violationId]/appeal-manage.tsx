"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageCircleQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

/**
 * Client-side management of one open appeal:
 *  - AppealRespond: the NEEDS_INFO reply card (one reply per round trip,
 *    honest deadline shown; the appeal returns to review after it).
 *  - AppealWithdraw: quiet withdraw affordance with a confirm dialog -
 *    available while the appeal is pre-decision.
 * Both post to the existing user appeal routes and refresh the RSC page so
 * the server read model takes over.
 */

const REPLY_MIN = 3;
const REPLY_MAX = 2000;

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export function AppealRespond({
  appealId,
  question,
  respondByLabel,
}: {
  appealId: string;
  /** The staff question (latest needs-info note), shown in the card. */
  question: string | null;
  /** Preformatted deadline date, e.g. "24 July 2026". */
  respondByLabel: string | null;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  const tooShort = text.trim().length < REPLY_MIN;

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/appeals/${appealId}/respond`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text.trim() }),
        });
        if (!res.ok) {
          setError(await readErrorMessage(res, "Something went wrong. Please try again."));
          return;
        }
        setSent(true);
        router.refresh();
      } catch {
        setError("Network error. Check your connection and try again.");
      }
    });
  }

  if (sent) {
    return (
      <section aria-label="Reply sent" className="glass mt-6 rounded-xl p-6">
        <h2 className="font-display text-xl font-semibold tracking-tight">Thanks - reply sent</h2>
        <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
          Your reply was added to the appeal and our team will continue the review. We&apos;ll email
          you once a decision has been made.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-label="We need a bit more information"
      className="border-gold/40 bg-gold/5 mt-6 rounded-xl border p-6"
    >
      <div className="flex items-start gap-4">
        <span className="bg-gold/15 flex size-12 shrink-0 items-center justify-center rounded-2xl">
          <MessageCircleQuestion className="text-gold size-6" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl font-semibold tracking-tight">
            We need a bit more information
          </h2>
          <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
            A member of our team has a question about your appeal. Your reply goes straight to the
            person reviewing it.
          </p>
          {question && (
            <blockquote className="bg-background/70 mt-3 rounded-2xl px-4 py-3 text-sm leading-relaxed">
              {question}
            </blockquote>
          )}
        </div>
      </div>

      <Textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value.slice(0, REPLY_MAX));
          if (error) setError(null);
        }}
        rows={4}
        maxLength={REPLY_MAX}
        placeholder="Write your reply here."
        aria-label="Your reply to our team"
        aria-invalid={error ? true : undefined}
        className="bg-background mt-4 min-h-24 rounded-3xl px-4 py-3"
        disabled={pending}
      />
      <div className="mt-1.5 flex items-baseline justify-between px-1">
        {error ? (
          <p className="text-destructive text-xs" role="alert">
            {error}
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">
            You can send one reply, so include everything that feels relevant.
          </p>
        )}
        <p className="text-muted-foreground text-xs tabular-nums">
          {text.trim().length}/{REPLY_MAX}
        </p>
      </div>
      <Button
        size="lg"
        className="mt-3 h-12 w-full rounded-full text-base"
        disabled={pending || tooShort}
        onClick={submit}
      >
        {pending ? "Sending…" : "Send reply"}
      </Button>
      {respondByLabel && (
        <p className="text-muted-foreground mt-3 text-center text-xs">
          Please reply by {respondByLabel}. If we don&apos;t hear back by then, this appeal closes
          automatically - you could still submit a new one afterwards.
        </p>
      )}
    </section>
  );
}

export function AppealWithdraw({ appealId }: { appealId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function withdraw() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/appeals/${appealId}/withdraw`, { method: "POST" });
        if (!res.ok) {
          setError(await readErrorMessage(res, "Something went wrong. Please try again."));
          return;
        }
        setOpen(false);
        router.refresh();
      } catch {
        setError("Network error. Check your connection and try again.");
      }
    });
  }

  return (
    <div className="mt-6 px-1">
      <p className="text-muted-foreground text-sm leading-relaxed">
        Changed your mind?{" "}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-foreground hover:text-muted-foreground min-h-11 font-medium underline underline-offset-2"
        >
          Withdraw this appeal
        </button>
      </p>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setError(null);
          setOpen(next);
        }}
      >
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle>Withdraw this appeal?</DialogTitle>
            <DialogDescription>
              The review stops and the current decision stays in place. Withdrawing is not a
              decision against you - you can submit a new appeal for this decision later.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" className="rounded-full" onClick={() => setOpen(false)}>
              Keep my appeal
            </Button>
            <Button
              variant="outline"
              className="rounded-full"
              disabled={pending}
              onClick={withdraw}
            >
              {pending ? "Withdrawing…" : "Withdraw appeal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
