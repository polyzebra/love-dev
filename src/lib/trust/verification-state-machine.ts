/**
 * L6.6 - THE Tirvea Verified Badge Trust Contract: the ONE canonical
 * verification state machine and public-badge resolver.
 *
 * PRODUCT CONTRACT (immutable): the blue Verified badge means EXACTLY
 *   "The identity of this member has been verified AND the currently visible
 *    public profile photos belong to that verified person."
 * If the system cannot prove that at this instant, the badge MUST NOT show.
 *
 * This module is the SINGLE SOURCE OF TRUTH for badge visibility and for the
 * verification lifecycle. No page, API, component, mapper, worker, or admin
 * tool may compute badge visibility or the trust state independently - they
 * import from here. Enforced by tests/trust-contract-governance.test.ts.
 *
 * PURE: no DB, no env, no I/O. Safe in any bundle.
 */

/** The complete, canonical verification lifecycle (Phase B). */
export const TrustState = {
  NOT_VERIFIED: "NOT_VERIFIED",
  PENDING: "PENDING", // session created, provider not yet deciding
  PROCESSING: "PROCESSING", // provider actively checking
  VERIFIED: "VERIFIED", // the ONLY state that shows the blue badge
  INVALIDATED: "INVALIDATED", // a material gallery change dropped the snapshot
  REQUIRES_REVERIFICATION: "REQUIRES_REVERIFICATION", // owner must verify photos again
  UNDER_REVIEW: "UNDER_REVIEW", // a human is deciding
  FAILED: "FAILED", // terminal provider failure (retry starts a new lifecycle)
  SUSPENDED: "SUSPENDED", // staff / face-layer / consent withdrawal withheld the badge
  ADMIN_RESTORED: "ADMIN_RESTORED", // staff restored after a successful review
} as const;
export type TrustState = (typeof TrustState)[keyof typeof TrustState];

/**
 * Legal transitions (Phase B). A transition NOT listed here is ILLEGAL and
 * assertTransition() throws. The critical safety invariants encoded below:
 *   - INVALIDATED can NEVER go straight to VERIFIED (must pass through
 *     REQUIRES_REVERIFICATION -> PROCESSING -> VERIFIED). This is what stops a
 *     late/duplicate/replayed webhook from resurrecting a stale badge.
 *   - SUSPENDED reaches VERIFIED only via ADMIN_RESTORED or a fresh lifecycle.
 *   - FAILED / NOT_VERIFIED can never jump to VERIFIED without PROCESSING.
 */
export const LEGAL_TRANSITIONS: Record<TrustState, readonly TrustState[]> = {
  NOT_VERIFIED: [TrustState.PENDING],
  PENDING: [
    TrustState.PROCESSING,
    TrustState.UNDER_REVIEW,
    TrustState.FAILED,
    TrustState.NOT_VERIFIED,
  ],
  PROCESSING: [
    TrustState.VERIFIED,
    TrustState.UNDER_REVIEW,
    TrustState.FAILED,
    TrustState.REQUIRES_REVERIFICATION,
  ],
  VERIFIED: [TrustState.INVALIDATED, TrustState.SUSPENDED, TrustState.UNDER_REVIEW],
  INVALIDATED: [TrustState.REQUIRES_REVERIFICATION, TrustState.UNDER_REVIEW],
  REQUIRES_REVERIFICATION: [TrustState.PROCESSING, TrustState.PENDING, TrustState.UNDER_REVIEW],
  UNDER_REVIEW: [
    TrustState.VERIFIED,
    TrustState.FAILED,
    TrustState.SUSPENDED,
    TrustState.ADMIN_RESTORED,
    TrustState.REQUIRES_REVERIFICATION,
  ],
  FAILED: [TrustState.PENDING, TrustState.NOT_VERIFIED],
  SUSPENDED: [
    TrustState.ADMIN_RESTORED,
    TrustState.UNDER_REVIEW,
    TrustState.REQUIRES_REVERIFICATION,
  ],
  ADMIN_RESTORED: [TrustState.VERIFIED, TrustState.INVALIDATED, TrustState.SUSPENDED],
};

/** Thrown when a caller attempts an illegal lifecycle transition. */
export class IllegalTrustTransitionError extends Error {
  constructor(
    readonly from: TrustState,
    readonly to: TrustState,
  ) {
    super(`Illegal verification transition: ${from} -> ${to}`);
    this.name = "IllegalTrustTransitionError";
  }
}

export function canTransition(from: TrustState, to: TrustState): boolean {
  return from === to || LEGAL_TRANSITIONS[from].includes(to);
}

/** Assert a transition is legal; throw IllegalTrustTransitionError otherwise.
 *  Used at every badge-restoring write (webhook approval, admin restore) so a
 *  stale/out-of-order event can never move INVALIDATED/SUSPENDED -> VERIFIED. */
export function assertTransition(from: TrustState, to: TrustState): void {
  if (!canTransition(from, to)) throw new IllegalTrustTransitionError(from, to);
}

/**
 * The exact facts the trust contract consumes. These map 1:1 onto the columns
 * carried by PUBLIC_BADGE_SELECT (+ optional workflow hints for owner/admin
 * surfaces). Loading them is a compile requirement of publicBadgeVisible().
 */
export type TrustFacts = {
  photoVerifiedAt: Date | null;
  faceBadgeSuspendedAt: Date | null;
  galleryVersion: number;
  verifiedGalleryVersion: number | null;
};

export type TrustFactsExtended = TrustFacts & {
  /** PHOTO Verification workflow row status (identity provider lifecycle). */
  workflowStatus?: "PENDING" | "IN_REVIEW" | "APPROVED" | "REJECTED" | "EXPIRED" | null;
  /** A provider session id exists (distinguishes PENDING from PROCESSING). */
  hasOpenSession?: boolean;
  /** ProfilePhotoVerification.status (face layer), when present. */
  faceStatus?: "MANUAL_REVIEW" | "SUSPENDED" | string | null;
  /** Whether an active reverification session is open (INVALIDATED vs REQUIRES_REVERIFICATION). */
  reverifying?: boolean;
};

/**
 * THE public-badge predicate (Phase A/F). The blue badge shows IFF ALL hold:
 *   1. identity verified                       (photoVerifiedAt)
 *   2. not suspended                           (!faceBadgeSuspendedAt)
 *   3. a verified-gallery snapshot exists      (verifiedGalleryVersion != null)
 *   4. the CURRENT gallery IS that snapshot    (verifiedGalleryVersion === galleryVersion)
 * (3)+(4) subsume "verified photos still exist / verified cover still matches":
 * any such change is material and increments galleryVersion, breaking (4).
 *
 * This is the ONLY place the conjunction is written. isPubliclyVerified()
 * delegates here; nothing else may recompute it.
 */
export function publicBadgeVisible(f: TrustFacts): boolean {
  return (
    f.photoVerifiedAt !== null &&
    !f.faceBadgeSuspendedAt &&
    f.verifiedGalleryVersion !== null &&
    f.verifiedGalleryVersion === f.galleryVersion
  );
}

/**
 * Resolve the ONE canonical trust state from the stored facts. Owner and admin
 * surfaces render from this; the public badge is exactly `=== VERIFIED`.
 * Deterministic and pure - the same facts always resolve to the same state.
 */
export function resolveTrustState(f: TrustFactsExtended): TrustState {
  // Pre-identity lifecycle.
  if (f.photoVerifiedAt === null) {
    switch (f.workflowStatus) {
      case "REJECTED":
        return TrustState.FAILED;
      case "IN_REVIEW":
        return TrustState.UNDER_REVIEW;
      case "PENDING":
        return f.hasOpenSession ? TrustState.PROCESSING : TrustState.PENDING;
      default:
        return TrustState.NOT_VERIFIED;
    }
  }

  // Identity verified - the photo/gallery contract decides the rest.
  if (f.faceStatus === "SUSPENDED") return TrustState.SUSPENDED;
  if (f.faceStatus === "MANUAL_REVIEW") return TrustState.UNDER_REVIEW;

  const versionMatches =
    f.verifiedGalleryVersion !== null && f.verifiedGalleryVersion === f.galleryVersion;

  if (!versionMatches) {
    // Gallery diverged from the verified snapshot (or never snapshotted).
    return f.reverifying ? TrustState.REQUIRES_REVERIFICATION : TrustState.INVALIDATED;
  }
  // Versions match but a non-gallery suspension is in force (admin/consent/face).
  if (f.faceBadgeSuspendedAt) return TrustState.SUSPENDED;
  return TrustState.VERIFIED;
}

/** Invariant: the public badge is visible IFF the canonical state is VERIFIED. */
export function badgeVisibleForState(state: TrustState): boolean {
  return state === TrustState.VERIFIED;
}
