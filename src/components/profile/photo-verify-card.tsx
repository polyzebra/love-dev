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
import { FACE_STATE_COPY, type FaceAction } from "@/lib/verification-presentation";
import dynamic from "next/dynamic";

// Biometric capture code is dynamically imported: it never ships to
// routes that don't render the verification card (Phase 23).
const LivenessCapture = dynamic(
  () => import("@/components/profile/liveness-capture").then((m) => m.LivenessCapture),
  { ssr: false },
);
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

export function PhotoVerifyCard({
  state,
  workflowStatus = null,
  facePresentation = null,
  liveness = null,
  faceAction = null,
}: {
  state: VerificationUxState;
  /** Raw Verification.status - WORDING only (expired vs rejected retry
   *  copy). Never used to derive behavior; `state` stays canonical. */
  workflowStatus?: "PENDING" | "IN_REVIEW" | "APPROVED" | "REJECTED" | "EXPIRED" | null;
  /** Face-layer presentation for VERIFIED users (profile-photo checks) -
   *  null renders the identity flow exactly as before. */
  facePresentation?:
    | "checking_profile_photos"
    | "photo_update_review"
    | "action_required"
    | "manual_review"
    | "consent_withdrawn"
    | null;
  /** Liveness capture required before profile photos can be checked (no
   *  trusted reference yet). Carries the consent version to accept. */
  liveness?: { consentVersion: string } | null;
  /** L8.3.1: the canonical face action (getFaceVerificationAction) - drives the
   *  enrolment-vs-match headline and, when the layer can't run, the explicit
   *  blocking reason. Null renders the identity flow exactly as before. */
  faceAction?: FaceAction | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<"closed" | "explainer" | "consent">("closed");
  const anchorRef = useRef<HTMLDivElement>(null);
  // Live sub-state of an OPEN session (Stripe: requires_input = the user
  // still has to finish; processing = Stripe is checking). Fetched once on
  // mount from the existing status endpoint - both sub-states are one
  // canonical "pending"; this only picks honest wording + the reopenable
  // hosted URL. null until (or unless) the fetch resolves.
  const [openSession, setOpenSession] = useState<{
    providerStatus: string | null;
    url: string | null;
  } | null>(null);
  useEffect(() => {
    if (state !== "pending") return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/verification/photo/status");
        if (!res.ok) return;
        const body = (await res.json()) as {
          data?: { session?: { providerStatus: string | null; url: string | null } | null };
        };
        if (alive && body.data?.session) setOpenSession(body.data.session);
      } catch {
        // Wording falls back to the resume variant; no error surface needed.
      }
    })();
    return () => {
      alive = false;
    };
  }, [state]);

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
        const body = (await res.json()) as {
          data?: { url?: string | null; reused?: boolean };
        };
        if (body.data?.url) {
          // Reused sessions return the SAME still-active hosted URL, so
          // continuing never mints a duplicate verification session.
          window.location.assign(body.data.url);
          return;
        }
        setStep("closed");
        toast.success(
          body.data?.reused
            ? "Your verification session is still open. We'll update your badge once it completes."
            : "Verification started. We'll update your badge once it completes.",
        );
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

  // -------------------------------------------------- face-layer states
  // (identity already verified - profile-photo verification refines what
  // the user sees; no provider vocabulary, no similarity scores)
  // Capture step: identity verified, face layer on, no trusted reference
  // yet -> the video-selfie liveness flow (Phases 23/24).
  // L8.3.1: this is the FIRST-TIME ENROLMENT entry point. It fires when the
  // canonical action is START_LIVENESS (layer live + legal gate open + no
  // reference) or the legacy capture state. Because the resolver only returns
  // START_LIVENESS AFTER the config/legal gates pass, the enrolment CTA can
  // never appear while the AWS layer is dormant - no prompt storm in prod.
  if (
    liveness &&
    (faceAction?.kind === "START_LIVENESS" || facePresentation === "checking_profile_photos")
  ) {
    return wrap(<LivenessCapture consentVersion={liveness.consentVersion} />);
  }
  if (
    facePresentation === "checking_profile_photos" ||
    facePresentation === "photo_update_review"
  ) {
    const copy = FACE_STATE_COPY[facePresentation];
    return wrap(
      <StateCard
        icon={<Hourglass className="text-gold size-5" aria-hidden="true" />}
        title={copy.title}
        body={copy.body}
      />,
    );
  }
  if (facePresentation === "action_required") {
    const copy = FACE_STATE_COPY.action_required;
    return wrap(
      <StateCard
        icon={<XCircle className="text-muted-foreground size-5" aria-hidden="true" />}
        title={copy.title}
        body={copy.body}
      />,
    );
  }
  if (facePresentation === "manual_review") {
    return wrap(
      <StateCard
        icon={<UserSearch className="text-gold size-5" aria-hidden="true" />}
        title="Verification under review"
        body="A member of our team is reviewing your verification. Nothing else is needed from you."
      />,
    );
  }
  if (facePresentation === "consent_withdrawn") {
    const copy = FACE_STATE_COPY.consent_withdrawn;
    return wrap(
      <StateCard
        icon={<XCircle className="text-muted-foreground size-5" aria-hidden="true" />}
        title={copy.title}
        body={copy.body}
      />,
    );
  }

  // ------------------------------------------------------------------ states
  if (state === "pending" || state === "verification_started") {
    // Honest sub-state wording: "processing" means the provider already
    // has the document/selfie and is checking it; anything else means the
    // session is open and WAITING FOR THE USER (Stripe requires_input, or
    // sub-state unknown - resuming is always safe because the start
    // endpoint reuses the open session instead of creating a duplicate).
    const processing = openSession?.providerStatus === "processing";
    if (processing) {
      return wrap(
        <StateCard
          icon={<Hourglass className="text-gold size-5" aria-hidden="true" />}
          title="Verification in progress"
          body="We're checking your identity. This usually takes only a few minutes."
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
          </div>
        </StateCard>,
      );
    }
    return wrap(
      <StateCard
        icon={<Camera className="text-gold size-5" aria-hidden="true" />}
        title="Complete your verification"
        body="Your verification session is ready. Continue with Stripe to verify your identity."
      >
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            size="sm"
            className="rounded-full px-5"
            disabled={pending}
            onClick={() => {
              // Reopen the SAME hosted session when its URL is already in
              // hand; otherwise the start endpoint resolves it (reusing
              // the open session, never creating a duplicate).
              if (openSession?.url) window.location.assign(openSession.url);
              else start();
            }}
          >
            Continue verification
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="rounded-full px-5"
            disabled={pending}
            onClick={checkStatus}
          >
            <RefreshCw className="size-4" aria-hidden="true" /> Check status
          </Button>
        </div>
      </StateCard>,
    );
  }

  if (state === "manual_review") {
    return wrap(
      <StateCard
        icon={<UserSearch className="text-gold size-5" aria-hidden="true" />}
        title="Verification under review"
        body="A member of our team is reviewing your verification. Nothing else is needed from you."
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
        </div>
      </StateCard>,
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

  // not_verified / retry_available - the invitation card. Retry wording
  // distinguishes an EXPIRED session ("nothing went wrong, it just lapsed")
  // from a rejected attempt - same canonical state, honest copy.
  const retry = state === "retry_available";
  const expired = retry && workflowStatus === "EXPIRED";
  return wrap(
    <section className="glass rounded-3xl p-5">
      <div className="flex items-start gap-3.5">
        <span className="glass-chip flex size-11 shrink-0 items-center justify-center rounded-full">
          <BadgeCheck className="text-gold size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-medium tracking-tight">
            {expired
              ? "Verification expired"
              : retry
                ? "Try photo verification again"
                : "Get photo verified"}
          </p>
          {retry && (
            <p className="text-muted-foreground mt-1 text-sm">
              {expired
                ? "Your previous verification session expired before it was completed. Start again whenever you're ready."
                : "Your last attempt didn't go through - that happens. You can start a fresh one any time."}
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
            {expired ? "Start again" : retry ? "Try again" : "Start verification"}
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
