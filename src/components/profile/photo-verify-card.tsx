"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BadgeCheck,
  Camera,
  Check,
  Hourglass,
  RefreshCw,
  ShieldCheck,
  UserSearch,
  XCircle,
} from "lucide-react";
import type { VerificationUxState } from "@/lib/services/photo-verification";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const BENEFITS = [
  "Verified badge on your profile",
  "Higher trust with the people you meet",
  "More visibility in Discover",
];

const HOW_IT_WORKS = [
  { icon: Camera, copy: "Take a quick selfie with our verification partner." },
  { icon: UserSearch, copy: "It's compared with your profile photos." },
  { icon: BadgeCheck, copy: "Your verified badge appears once it matches." },
];

/**
 * Photo verification flow on the profile page. Renders every UX state from
 * deriveVerificationUxState (the parent hides it entirely once verified OR
 * when no provider is configured - the compact status row's "Coming soon"
 * is the ONE unavailable message, so this card never needs an unconfigured
 * branch): explainer modal -> consent -> provider session start -> pending /
 * manual-review / retry / failed states. Selfie capture happens on the
 * provider's side only; Tirvea never stores biometric data.
 */
export const PHOTO_VERIFICATION_ANCHOR = "photo-verification";

export function PhotoVerifyCard({ state }: { state: VerificationUxState }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<"closed" | "explainer" | "consent">("closed");
  const anchorRef = useRef<HTMLDivElement>(null);

  // Deep links (#photo-verification from Settings or the profile trust
  // row) land ON the card: scroll it into view and move focus to the
  // wrapper (tabIndex -1) so screen readers announce it. Effect-on-mount
  // against a ref - no timeouts, no brittleness; normal back behavior is
  // untouched (we never write history).
  useEffect(() => {
    if (window.location.hash === `#${PHOTO_VERIFICATION_ANCHOR}` && anchorRef.current) {
      anchorRef.current.scrollIntoView({ block: "start" });
      anchorRef.current.focus({ preventScroll: true });
    }
  }, []);

  const wrap = (content: React.ReactNode) => (
    <div
      id={PHOTO_VERIFICATION_ANCHOR}
      ref={anchorRef}
      tabIndex={-1}
      aria-label="Photo verification"
      className="scroll-mt-24 outline-none"
    >
      {content}
    </div>
  );

  function start() {
    startTransition(async () => {
      try {
        const res = await fetch("/api/verification/photo/start", { method: "POST" });
        if (res.status === 503) {
          setStep("closed");
          toast("Photo verification is coming soon", {
            description: "We're getting this ready. You'll be able to verify from here soon.",
          });
          return;
        }
        if (!res.ok) {
          toast.error("Couldn't start verification. Please try again later.");
          return;
        }
        const body = (await res.json()) as { data?: { url?: string | null } };
        if (body.data?.url) {
          window.location.assign(body.data.url);
          return;
        }
        setStep("closed");
        toast.success("Verification started. We'll update your badge once it completes.");
        router.refresh();
      } catch {
        toast.error("Network error. Check your connection and try again.");
      }
    });
  }

  function checkStatus() {
    startTransition(async () => {
      try {
        const res = await fetch("/api/verification/photo/status");
        if (!res.ok) {
          toast.error("Couldn't check the status. Please try again later.");
          return;
        }
        const body = (await res.json()) as { data?: { state?: VerificationUxState } };
        const next = body.data?.state;
        if (next === "verified") {
          toast.success("You're verified! Your badge is now live.");
        } else if (next === state) {
          toast("No update yet", {
            description: "We're still waiting for the result. This usually only takes a minute.",
          });
        }
        router.refresh();
      } catch {
        toast.error("Network error. Check your connection and try again.");
      }
    });
  }

  // ------------------------------------------------------------------ states
  if (state === "pending" || state === "verification_started") {
    return wrap(
      <StateCard
        icon={<Hourglass className="text-gold size-5" aria-hidden="true" />}
        title="Verification in progress"
        body={
          state === "pending"
            ? "We're waiting for the result from our verification partner. We'll update your badge the moment it lands."
            : "Your verification session is open. Finish the selfie step to complete it - or check back here for the result."
        }
      >
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="rounded-full px-5"
            disabled={pending}
            onClick={checkStatus}
          >
            <RefreshCw className="size-4" aria-hidden="true" /> Check status
          </Button>
          {state === "verification_started" && (
            <Button
              size="sm"
              variant="ghost"
              className="rounded-full px-5"
              disabled={pending}
              onClick={start}
            >
              Resume verification
            </Button>
          )}
        </div>
      </StateCard>,
    );
  }

  if (state === "manual_review") {
    return wrap(
      <StateCard
        icon={<UserSearch className="text-gold size-5" aria-hidden="true" />}
        title="Under review"
        body="Your verification needs a quick manual review by our team. Nothing else is needed from you - we'll email you the result."
      />,
    );
  }

  if (state === "failed") {
    return wrap(
      <StateCard
        icon={<XCircle className="text-muted-foreground size-5" aria-hidden="true" />}
        title="Verification couldn't be completed"
        body="This attempt was final and can't be retried. Your profile stays fully usable - photo verification just won't show a badge."
      />,
    );
  }

  // not_verified / retry_available - the invitation card.
  const retry = state === "retry_available";
  return wrap(
    <section className="glass rounded-3xl p-5">
      <div className="flex items-start gap-3.5">
        <span className="glass-chip flex size-11 shrink-0 items-center justify-center rounded-full">
          <BadgeCheck className="text-gold size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-medium tracking-tight">
            {retry ? "Try photo verification again" : "Get photo verified"}
          </p>
          {retry && (
            <p className="text-muted-foreground mt-1 text-sm">
              Your last attempt didn&apos;t go through - that happens. You can start a fresh one any
              time.
            </p>
          )}
          <ul className="mt-2 space-y-1.5">
            {BENEFITS.map((benefit) => (
              <li key={benefit} className="text-muted-foreground flex items-center gap-2 text-sm">
                <Check className="text-success size-3.5 shrink-0" aria-hidden="true" />
                {benefit}
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            className="mt-4 rounded-full px-5"
            disabled={pending}
            onClick={() => setStep("explainer")}
          >
            {retry ? "Try again" : "Start verification"}
          </Button>
        </div>
      </div>

      <Dialog open={step !== "closed"} onOpenChange={(open) => !open && setStep("closed")}>
        <DialogContent className="rounded-3xl">
          {step === "explainer" ? (
            <>
              <DialogHeader>
                <DialogTitle className="font-display text-xl tracking-tight">
                  Photo verification
                </DialogTitle>
                <DialogDescription>
                  Photo verification helps people know you are real.
                </DialogDescription>
              </DialogHeader>
              <ul className="space-y-3">
                {HOW_IT_WORKS.map(({ icon: Icon, copy }) => (
                  <li key={copy} className="flex items-center gap-3 text-sm">
                    <span className="bg-accent flex size-9 shrink-0 items-center justify-center rounded-2xl">
                      <Icon className="text-accent-foreground size-4.5" aria-hidden="true" />
                    </span>
                    {copy}
                  </li>
                ))}
              </ul>
              <DialogFooter>
                <Button variant="ghost" className="rounded-full" onClick={() => setStep("closed")}>
                  Not now
                </Button>
                <Button className="rounded-full" onClick={() => setStep("consent")}>
                  Continue
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="font-display text-xl tracking-tight">
                  Before you start
                </DialogTitle>
                <DialogDescription>A quick word on how your selfie is handled.</DialogDescription>
              </DialogHeader>
              <div className="bg-foreground/5 text-muted-foreground flex items-start gap-3 rounded-2xl p-4 text-sm leading-relaxed">
                <ShieldCheck className="text-success mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <p>
                  Your selfie is captured and checked by our verification partner, not by Tirvea. We
                  only receive the result -{" "}
                  <span className="text-foreground font-medium">
                    we never store your selfie or any biometric data
                  </span>
                  . By continuing you consent to photo verification.
                </p>
              </div>
              <DialogFooter>
                <Button
                  variant="ghost"
                  className="rounded-full"
                  onClick={() => setStep("explainer")}
                >
                  Back
                </Button>
                <Button className="rounded-full" disabled={pending} onClick={start}>
                  {pending ? "Starting…" : "Agree & continue"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>,
  );
}

function StateCard({
  icon,
  title,
  body,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="glass rounded-3xl p-5">
      <div className="flex items-start gap-3.5">
        <span className="glass-chip flex size-11 shrink-0 items-center justify-center rounded-full">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-medium tracking-tight">{title}</p>
          <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{body}</p>
          {children}
        </div>
      </div>
    </section>
  );
}
