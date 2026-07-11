"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Hourglass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const MIN_LENGTH = 10;
const MAX_LENGTH = 2000;

/**
 * Appeal composer for one violation: textarea + a sticky bottom "Submit
 * appeal" CTA that sits above the home indicator (safe-area padded).
 * Posts to the existing /api/appeals route (restricted-tolerant) and flips
 * to the pending state locally, then refreshes the RSC page so the server
 * read model takes over.
 */
export function AppealForm({ violationId }: { violationId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [pending, startTransition] = useTransition();

  const tooShort = text.trim().length < MIN_LENGTH;

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/appeals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ violationId, appealText: text.trim() }),
        });
        if (!res.ok) {
          let message = "Something went wrong. Please try again.";
          try {
            const body = (await res.json()) as { error?: { message?: string } };
            message = body.error?.message ?? message;
          } catch {
            // keep fallback
          }
          setError(message);
          return;
        }
        setSubmitted(true);
        router.refresh();
      } catch {
        setError("Network error. Check your connection and try again.");
      }
    });
  }

  if (submitted) {
    return (
      <section aria-label="Appeal submitted" className="glass mt-6 rounded-[28px] p-6">
        <div className="flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-foreground/5">
            <Hourglass className="size-6 text-gold" aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-display text-xl font-semibold tracking-tight">
              Appeal pending review
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Our Trust &amp; Safety team will review your appeal and email you once a decision has
              been made.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <>
      <section aria-label="Submit an appeal" className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Your appeal
        </h2>
        <Textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value.slice(0, MAX_LENGTH));
            if (error) setError(null);
          }}
          rows={5}
          maxLength={MAX_LENGTH}
          placeholder="Tell us, in your own words, why you believe this decision should be reviewed."
          aria-label="Why are you appealing this decision?"
          aria-invalid={error ? true : undefined}
          className="mt-2 min-h-32 rounded-3xl px-4 py-3"
          disabled={pending}
        />
        <div className="mt-1.5 flex items-baseline justify-between px-1">
          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {tooShort ? `At least ${MIN_LENGTH} characters.` : "Thanks - that helps our team."}
            </p>
          )}
          <p className="text-xs tabular-nums text-muted-foreground">
            {text.trim().length}/{MAX_LENGTH}
          </p>
        </div>
      </section>

      {/* Spacer so page content is never hidden behind the sticky bar. */}
      <div aria-hidden="true" className="h-24" />

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/85 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto w-full max-w-2xl px-5 py-3">
          <Button
            size="lg"
            className="h-12 w-full rounded-full text-base"
            disabled={pending || tooShort}
            onClick={submit}
          >
            {pending ? "Submitting…" : "Submit appeal"}
          </Button>
        </div>
      </div>
    </>
  );
}
