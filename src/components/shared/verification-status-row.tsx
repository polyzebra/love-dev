import Link from "next/link";
import type { VerificationUxState } from "@/lib/services/photo-verification";
import type { FaceAction } from "@/lib/verification-presentation";
import { BadgeCheck, CircleAlert, CircleDashed, Hourglass, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * THE shared verification status row (Phase 3 of the verification
 * go-live). One visual vocabulary for Email/Phone/Photo/ID rows across
 * the profile trust strip and the account settings list - surfaces may
 * differ in copy and density (`variant`), never in state semantics.
 */

export type VerificationRowState = "verified" | "todo" | "pending" | "needs-action" | "unavailable";

export const VERIFICATION_STATE_ICON: Record<
  VerificationRowState,
  { icon: LucideIcon; className: string }
> = {
  verified: { icon: BadgeCheck, className: "text-success" },
  pending: { icon: Hourglass, className: "text-gold" },
  "needs-action": { icon: CircleAlert, className: "text-muted-foreground" },
  todo: { icon: CircleDashed, className: "text-muted-foreground/40" },
  unavailable: { icon: CircleDashed, className: "text-muted-foreground/50" },
};

/**
 * THE one mapping from the canonical photo-verification UX state to row
 * presentation. Profile row, Settings row and PhotoVerifyCard all read
 * the SAME VerificationUxState (deriveVerificationUxState) - this
 * mapper is the only switch, so the surfaces can never disagree
 * ("Photo verified -> Verify" next to "Verification in progress" is
 * impossible by construction).
 *
 * The in-progress/review/retry actions always target the ONE flow card
 * anchor; `failed` (staff-marked FINAL rejection) deliberately offers no
 * retry anywhere - mirroring the card's final state.
 */
export function photoVerificationRow(
  ux: VerificationUxState,
  opts: {
    configured: boolean;
    surface: "profile" | "settings";
    /** L8.3.1: the canonical face action (getFaceVerificationAction). When the
     *  badge was withheld it disambiguates the row - first-time enrolment vs a
     *  photo match vs an explicit blocking reason - instead of the bare
     *  "Verified badge removed". Both surfaces pass the SAME resolved action. */
    faceAction?: FaceAction;
  },
): {
  label: string;
  state: VerificationRowState;
  value?: string;
  action: { label: string; href: string } | null;
} {
  const anchor = opts.surface === "profile" ? "#photo-verification" : "/profile#photo-verification";
  switch (ux) {
    case "verified":
      return { label: "Verified", state: "verified", value: "Verified", action: null };
    case "requires_reverification": {
      // L6.6 Phase I: the verified badge was removed because the profile photos
      // changed. Identity is intact; the owner must act to restore the badge.
      // L8.3.1: the ambiguous bare "Verified badge removed" is disambiguated
      // by the canonical face action WHEN the AWS layer is live - first-time
      // enrolment ("Start Face Verification") vs a photo match ("Verify New
      // Photo"). When the layer is dormant/blocked the legacy Stripe re-verify
      // CTA still restores the badge, so we FALL BACK to it (never show a
      // "face verification unavailable" message next to a working flow).
      const fa = opts.faceAction;
      if (fa && (fa.kind === "START_LIVENESS" || fa.kind === "VERIFY_PHOTO") && fa.label) {
        return {
          label:
            fa.kind === "START_LIVENESS" ? "Face verification needed" : "Verified badge removed",
          state: "needs-action",
          value:
            fa.kind === "START_LIVENESS"
              ? "First-time face verification needed"
              : "Your profile photo changed - confirm it's you",
          action: opts.configured ? { label: fa.label, href: anchor } : null,
        };
      }
      // Layer dormant/blocked, or no action supplied - the legacy re-verify row.
      return {
        label: "Verified badge removed",
        state: "needs-action",
        value: "Your profile photos changed",
        action: opts.configured ? { label: "Verify Photos", href: anchor } : null,
      };
    }
    case "pending":
    case "verification_started":
      // "Session open" is true for BOTH provider sub-states (user still
      // finishing vs provider checking) - the rows can't know which from
      // stored state alone, so they never claim "in progress"; the card
      // (which asks the provider live) carries the precise wording.
      return {
        label: "Photo verification",
        state: "pending",
        value: "Session open",
        action: opts.surface === "settings" ? { label: "View status", href: anchor } : null,
      };
    case "manual_review":
      return {
        label: "Photo verification",
        state: "pending",
        value: "Under review",
        action: null,
      };
    case "retry_available":
      return {
        label: "Photo verification",
        state: "needs-action",
        value: "Didn't go through - try again",
        action: opts.configured ? { label: "Try again", href: anchor } : null,
      };
    case "failed":
      return {
        label: "Photo verification",
        state: "needs-action",
        value: "Not completed",
        action: null,
      };
    case "not_verified":
      return opts.configured
        ? {
            label: "Photo verification",
            state: "todo",
            value: "Not verified",
            action: { label: opts.surface === "profile" ? "Verify" : "Start", href: anchor },
          }
        : {
            label: "Photo verification",
            state: "unavailable",
            value: "Coming soon",
            action: null,
          };
  }
}

export function VerificationStatusRow({
  label,
  state,
  value,
  action,
  variant = "chip",
}: {
  label: string;
  state: VerificationRowState;
  /** Secondary line (settings list); omitted in the compact chip variant. */
  value?: string;
  /** Real destination only - no dead buttons (null = no action). */
  action: { label: string; href: string } | null;
  /** chip = profile trust strip; list = settings rows. */
  variant?: "chip" | "list";
}) {
  const { icon: Icon, className } = VERIFICATION_STATE_ICON[state];

  if (variant === "list") {
    return (
      <div className="flex items-center gap-3 py-3.5 first:pt-0 last:pb-0">
        <Icon className={`size-5 shrink-0 ${className}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{label}</p>
          {value && (
            <p className="text-muted-foreground truncate text-sm" title={value}>
              {value}
            </p>
          )}
        </div>
        {action && (
          <Button variant="outline" className="h-11 shrink-0 rounded-full px-4" asChild>
            <Link href={action.href}>{action.label}</Link>
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="glass flex items-center gap-2.5 rounded-3xl px-4 py-3.5 text-sm">
      <Icon className={`size-5 shrink-0 ${className}`} aria-hidden="true" />
      <span className={state === "verified" ? "" : "text-muted-foreground"}>{label}</span>
      {value && state !== "verified" && state !== "todo" && (
        <span className="text-muted-foreground/70 ml-auto truncate text-xs">{value}</span>
      )}
      {action && (
        <Button
          variant="link"
          size="sm"
          className={
            value && state !== "verified" && state !== "todo" ? "h-auto p-0" : "ml-auto h-auto p-0"
          }
          asChild
        >
          <Link href={action.href}>{action.label}</Link>
        </Button>
      )}
    </div>
  );
}
