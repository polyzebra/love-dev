"use client";

import { Check, Clock, Loader2, ShieldCheck, Video, XCircle } from "lucide-react";
import type {
  CardTone,
  TimelineCard,
  TimelineStep,
  VerificationTimeline as Timeline,
} from "@/lib/verification-timeline";
import { Button } from "@/components/ui/button";

/**
 * L10.0 - the canonical verification progress timeline + status card.
 *
 * Accessibility: the card is an aria-live region so screen readers announce each
 * transition; every step pairs an ICON with text (never colour alone); completed
 * steps are plain <li>s (not interactive) so they never look clickable; motion is
 * gated behind motion-safe so reduced-motion users get a still UI. Mobile: a
 * comfortable max-width column with responsive type; no fixed pixel widths.
 */

const TONE: Record<CardTone, { ring: string; icon: string; chip: string }> = {
  progress: { ring: "ring-brand-bright/30", icon: "text-gold", chip: "glass-chip" },
  review: { ring: "ring-gold/30", icon: "text-gold", chip: "glass-chip" },
  success: { ring: "ring-success/40", icon: "text-success", chip: "bg-success/10" },
  action: { ring: "ring-border", icon: "text-muted-foreground", chip: "bg-foreground/5" },
  idle: { ring: "ring-border", icon: "text-gold", chip: "glass-chip" },
};

function StepDot({ status }: { status: TimelineStep["status"] }) {
  if (status === "done") {
    return (
      <span className="bg-success/15 text-success motion-safe:animate-in motion-safe:zoom-in-75 flex size-6 items-center justify-center rounded-full duration-300">
        <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className="border-gold/60 text-gold flex size-6 items-center justify-center rounded-full border-2">
        <span className="bg-gold motion-safe:animate-pulse size-2 rounded-full" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span
      className="border-border flex size-6 items-center justify-center rounded-full border-2"
      aria-hidden="true"
    >
      <span className="bg-muted-foreground/30 size-1.5 rounded-full" />
    </span>
  );
}

function StatusIcon({ tone, spinner }: { tone: CardTone; spinner: boolean }) {
  const cls = `${TONE[tone].icon} size-5`;
  if (spinner) return <Loader2 className={`${cls} motion-safe:animate-spin`} aria-hidden="true" />;
  if (tone === "success") return <ShieldCheck className={cls} aria-hidden="true" />;
  if (tone === "action") return <XCircle className={cls} aria-hidden="true" />;
  if (tone === "review") return <Clock className={cls} aria-hidden="true" />;
  return <Video className={cls} aria-hidden="true" />;
}

export function VerificationTimeline({
  timeline,
  onAction,
}: {
  timeline: Timeline;
  /** The surface wires the stable action token (START_LIVENESS, etc.). */
  onAction?: (action: NonNullable<TimelineCard["cta"]>["action"]) => void;
}) {
  const { steps, card } = timeline;
  const tone = TONE[card.tone];

  return (
    <section
      aria-label="Verification progress"
      className={`glass mx-auto w-full max-w-md rounded-3xl p-5 ring-1 sm:p-6 ${tone.ring}`}
    >
      {/* Status card - live region so each transition is announced. */}
      <div role="status" aria-live="polite" className="flex items-start gap-3.5">
        <span
          className={`${tone.chip} flex size-11 shrink-0 items-center justify-center rounded-full`}
        >
          <StatusIcon tone={card.tone} spinner={card.spinner} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-medium tracking-tight text-balance">
            {card.title}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{card.body}</p>
          {card.cta && (
            <Button
              size="sm"
              variant={card.tone === "review" ? "outline" : "default"}
              className="mt-4 rounded-full px-5"
              onClick={() => onAction?.(card.cta!.action)}
            >
              {card.cta.label}
            </Button>
          )}
        </div>
      </div>

      {/* Step timeline. Completed steps are non-interactive list items. */}
      <ol className="border-border/60 mt-5 space-y-3 border-t pt-5">
        {steps.map((step) => (
          <li key={step.key} className="flex items-center gap-3">
            <StepDot status={step.status} />
            <span
              className={
                step.status === "done"
                  ? "text-foreground text-sm font-medium"
                  : step.status === "active"
                    ? "text-foreground text-sm font-medium"
                    : "text-muted-foreground text-sm"
              }
            >
              {step.label}
            </span>
            {step.status === "active" && (
              <span className="text-gold ml-auto text-xs font-medium tracking-wide">In progress</span>
            )}
            {step.status === "done" && (
              <span className="text-success ml-auto text-xs font-medium">Done</span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
