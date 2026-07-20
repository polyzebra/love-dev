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

// ---------------------------------------------------------------------------
// L6.12 - per-photo badge contract (readiness layer). PURE and canonical: the
// ONLY place the per-photo conjunction is written. Gated at the call site by
// FACE_BADGE_PER_PHOTO (see verification.ts resolveBadgeVisible); flag OFF keeps
// publicBadgeVisible above as the live resolver, byte-for-byte. Reuses the
// existing pipeline's data (PhotoFaceCheck decisions, Photo.mediaVersion,
// ProfilePhotoVerification.referenceId/referenceVersion) - no new pipeline.
// ---------------------------------------------------------------------------

/** One PhotoFaceCheck row, as the resolver needs it (no biometric data). */
export type PerPhotoCheckFact = {
  /** Photo the check was computed for. */
  photoId: string;
  /** Immutable image-version pin the check is valid for (Photo.mediaVersion). */
  photoVersion: number;
  /** The reference the check was computed against (currency; null = unknown). */
  referenceVersion: number | null;
  /** The role the check was scored under (cover vs gallery decision tables). */
  isCoverAtCheck: boolean;
  decision: "PENDING" | "PASSED" | "ALLOWED" | "FLAGGED" | "REJECTED";
};

/** One currently-public required photo + its current check (or null). */
export type RequiredPhotoFact = {
  photoId: string;
  /** Current stored image version. */
  mediaVersion: number;
  isCover: boolean;
  /** The check pinned to this exact (photoId, mediaVersion), or null. */
  check: PerPhotoCheckFact | null;
};

export type PerPhotoBadgeFacts = {
  /** Stripe identity approval (unchanged - identity is verified once). */
  photoVerifiedAt: Date | null;
  /** Any active suspension / revocation. */
  faceBadgeSuspendedAt: Date | null;
  /** The active trusted face reference (null once rotating / never enrolled). */
  currentReferenceId: string | null;
  currentReferenceVersion: number | null;
  /**
   * The currently-public REQUIRED photo set (Photo.status = ACTIVE). Hidden /
   * deleted / historical photos are excluded by the assembler and never
   * required here.
   */
  requiredPhotos: RequiredPhotoFact[];
};

/**
 * THE per-photo public-badge predicate. Badge shows IFF ALL hold:
 *   1. Stripe identity approved            (photoVerifiedAt)
 *   2. no active suspension / revocation   (!faceBadgeSuspendedAt)
 *   3. a current valid face reference      (currentReferenceId + version)
 *   4. at least one required public photo  (the cover)
 *   5. every required public photo has a check that:
 *        - belongs to that exact photoId,
 *        - matches the current Photo.mediaVersion (no stale bytes),
 *        - was computed against the CURRENT reference (no stale reference),
 *        - was scored in the correct cover/gallery role, and
 *        - satisfies the cover/gallery decision policy:
 *            cover   -> PASSED (strict match),
 *            gallery -> PASSED or ALLOWED (match, or a permitted no-face photo).
 * PENDING / FLAGGED / REJECTED never pass. Fail-closed on any missing fact.
 *
 * Reorder never reaches here (mediaVersion is unchanged by order). Stripe alone
 * can never satisfy it (conditions 3-5 require the AWS per-photo checks).
 */
export function publicBadgePerPhotoVisible(f: PerPhotoBadgeFacts): boolean {
  if (f.photoVerifiedAt === null) return false; // 1
  if (f.faceBadgeSuspendedAt) return false; // 2
  if (f.currentReferenceId === null || f.currentReferenceVersion === null) return false; // 3
  if (f.requiredPhotos.length === 0) return false; // 4
  for (const p of f.requiredPhotos) {
    const c = p.check;
    if (!c) return false; // never verified at this version
    if (c.photoId !== p.photoId) return false; // wrong photo
    if (c.photoVersion !== p.mediaVersion) return false; // stale mediaVersion
    if (c.referenceVersion !== f.currentReferenceVersion) return false; // stale reference
    if (c.isCoverAtCheck !== p.isCover) return false; // scored in the wrong role
    if (p.isCover) {
      if (c.decision !== "PASSED") return false; // cover: strict match only
    } else if (c.decision !== "PASSED" && c.decision !== "ALLOWED") {
      return false; // gallery: match, or a permitted no-face photo
    }
  }
  return true;
}

/**
 * The canonical badge state code (Phase F). Safe UX state only - NEVER any
 * biometric / provider / confidence detail. `LEGACY_VISIBLE` is set by the
 * dispatcher for non-cohort users (they are on the whole-gallery contract);
 * `VERIFIED` is the per-photo success terminal.
 */
export type PerPhotoBadgeReason =
  | "LEGACY_VISIBLE"
  | "STRIPE_REQUIRED"
  | "SUSPENDED"
  | "REFERENCE_REQUIRED"
  | "NO_REQUIRED_PHOTOS"
  | "PHOTO_CHECK_PENDING"
  | "STALE_PHOTO_VERSION"
  | "STALE_REFERENCE"
  | "COVER_CHECK_FAILED"
  | "PHOTO_CHECK_FAILED"
  | "VERIFIED";

/**
 * The per-photo badge state code (same order as the predicate). Returns
 * "VERIFIED" iff publicBadgePerPhotoVisible(f) is true. Carries NO biometric
 * data - a coarse UX state only.
 */
export function perPhotoBadgeReason(f: PerPhotoBadgeFacts): PerPhotoBadgeReason {
  if (f.photoVerifiedAt === null) return "STRIPE_REQUIRED";
  if (f.faceBadgeSuspendedAt) return "SUSPENDED";
  if (f.currentReferenceId === null || f.currentReferenceVersion === null)
    return "REFERENCE_REQUIRED";
  if (f.requiredPhotos.length === 0) return "NO_REQUIRED_PHOTOS";
  for (const p of f.requiredPhotos) {
    const c = p.check;
    if (!c) return "PHOTO_CHECK_PENDING";
    if (c.photoVersion !== p.mediaVersion) return "STALE_PHOTO_VERSION";
    if (c.referenceVersion !== f.currentReferenceVersion) return "STALE_REFERENCE";
    if (c.decision === "PENDING") return "PHOTO_CHECK_PENDING";
    if (p.isCover) {
      if (c.decision !== "PASSED" || c.isCoverAtCheck !== true) return "COVER_CHECK_FAILED";
    } else if (c.decision !== "PASSED" && c.decision !== "ALLOWED") {
      return "PHOTO_CHECK_FAILED";
    }
  }
  return "VERIFIED";
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
