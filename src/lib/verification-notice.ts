import type { VerificationUxState } from "@/lib/services/photo-verification";

/**
 * Pure decision rules for the global photo-verification notices (banner
 * + one-time toasts). Framework-free so the whole matrix is unit-testable;
 * the client component only does storage/rendering.
 *
 * Source of truth: the CANONICAL UX state (deriveVerificationUxState),
 * evaluated server-side in the (app) layout on every request - no client
 * polling, no timers, no duplicate state. "Automatic" updates ride the
 * existing refresh flow: navigation re-renders the layout, the card's own
 * actions router.refresh(), and background reconciliation feeds the same
 * canonical state.
 */

/** In-flight states that show the global banner. */
export const BANNER_STATES: readonly VerificationUxState[] = [
  "pending",
  "verification_started",
  "manual_review",
];

/** Pages that already render the detailed card - the banner stays off. */
export function bannerHiddenOn(pathname: string): boolean {
  return pathname === "/profile" || pathname === "/settings/account";
}

/** localStorage keys - scoped per provider session, so a NEW verification
 *  session automatically resets watch/ack eligibility. */
export const watchKey = (sessionId: string) => `verif-watch:${sessionId}`;
export const ackKey = (sessionId: string) => `verif-ack:${sessionId}`;
/** sessionStorage - a dismissal lasts for the browsing session only. */
export const dismissKey = (sessionId: string) => `verif-banner-dismissed:${sessionId}`;

export type VerificationToast = "verified" | "failed" | "expired" | null;

export const TOAST_COPY: Record<
  Exclude<VerificationToast, null>,
  { title: string; body: string }
> = {
  verified: {
    title: "✅ Photo verified",
    body: "Your verified badge is now visible on your profile.",
  },
  failed: {
    title: "Photo verification wasn't successful.",
    body: "You can try again anytime.",
  },
  expired: {
    title: "Verification expired.",
    body: "Start a new verification whenever you're ready.",
  },
};

export type NoticeInput = {
  state: VerificationUxState | null;
  /** Provider session id - the one-time scope. Null = no session ever. */
  sessionId: string | null;
  pathname: string;
  /** This device observed the in-flight state for this session. */
  watched: boolean;
  /** This device already showed the outcome toast for this session. */
  acked: boolean;
  /** The banner was dismissed this browsing session. */
  dismissed: boolean;
};

export type NoticeDecision = {
  showBanner: boolean;
  /** Outcome toast to show NOW (caller acks after showing). */
  toast: VerificationToast;
  /** Mark this session as watched (in-flight state observed here). */
  markWatched: boolean;
};

export function decideVerificationNotice(input: NoticeInput): NoticeDecision {
  const { state, sessionId, pathname, watched, acked, dismissed } = input;
  if (!state || !sessionId) return { showBanner: false, toast: null, markWatched: false };

  const inFlight = BANNER_STATES.includes(state);
  const showBanner = inFlight && !dismissed && !bannerHiddenOn(pathname);

  // One-time outcome toasts: only when this device WATCHED the in-flight
  // phase of this exact session (a long-verified user on a fresh device
  // never gets a stale toast) and the outcome is not yet acknowledged.
  let toast: VerificationToast = null;
  if (watched && !acked) {
    if (state === "verified") toast = "verified";
    else if (state === "failed") toast = "failed";
    else if (state === "retry_available") toast = "expired";
  }

  return { showBanner, toast, markWatched: inFlight && !watched };
}
