import type { VerificationUxState } from "@/lib/services/photo-verification";

/**
 * Combined verification presentation - the full front-end state matrix.
 *
 * Pure: identity UX state (deriveVerificationUxState - canonical, 7
 * states, UNCHANGED) x face-layer job state -> ONE presentation state.
 * Users never see provider vocabulary (requires_input, similarity
 * percentages, providerStatus) - only these states' copy.
 *
 * While the face layer is dormant (no job row / FACE_MATCH_PROVIDER
 * unset), identity states map 1:1 and behavior is identical to the
 * pre-face-check system.
 */

/**
 * Liveness capture sub-states (Phase 23). They live INSIDE the
 * checking_profile_photos phase of the canonical machine - not a second
 * state machine: the canonical state stays authoritative, these only
 * describe where the user is inside the capture step.
 */
export type LivenessCaptureState =
  | "consent_required"
  | "capture_ready"
  | "camera_permission_required"
  | "capturing"
  | "capture_submitted"
  | "liveness_processing"
  | "capture_failed"
  | "provider_unavailable";

export const LIVENESS_COPY: Record<LivenessCaptureState, { title: string; body: string }> = {
  consent_required: {
    title: "One quick video selfie",
    body: "We compare a short video selfie with your profile photos to confirm they're really you. It's checked by our verification partner - Tirvea never stores your face data.",
  },
  capture_ready: {
    title: "Ready when you are",
    body: "Find good, even lighting and hold your phone at eye level. Your whole face should fit inside the oval.",
  },
  camera_permission_required: {
    title: "Camera access needed",
    body: "Allow camera access in your browser, then tap Try again. On iPhone: Settings > Safari > Camera. On Android: the padlock icon in the address bar.",
  },
  capturing: {
    title: "Hold still",
    body: "Look at the camera and follow the on-screen guidance.",
  },
  capture_submitted: {
    title: "Uploading your check",
    body: "Almost done - keep this page open.",
  },
  liveness_processing: {
    title: "Checking it's really you",
    body: "This usually takes a few seconds.",
  },
  capture_failed: {
    title: "That didn't work",
    body: "The check couldn't be completed - lighting or movement is the usual cause. You can try again right away.",
  },
  provider_unavailable: {
    title: "We can't run this right now",
    body: "Our verification partner is temporarily unavailable. Your verification is safe - please try again later.",
  },
};

export type VerificationPresentationState =
  | "not_started" // invite: Start photo verification
  | "requires_input" // open session: Continue verification
  | "processing_identity" // Stripe checking the document/selfie
  | "checking_profile_photos" // face layer running (first pass)
  | "manual_review" // human decides (identity OR face layer)
  | "verified" // badge live
  | "photo_update_review" // new/changed photo being re-checked
  | "action_required" // replace the offending photo (cover rejected)
  | "consent_withdrawn" // owner turned OFF face comparison; badge hidden
  | "failed" // final, no retry
  | "expired"; // session lapsed - start again

export type FaceLayerSnapshot = {
  status:
    | "LIVENESS_REQUIRED"
    | "QUEUED"
    | "CLAIMED"
    | "CHECKING"
    | "AUTO_VERIFIED"
    | "MANUAL_REVIEW"
    | "REJECTED"
    | "SUSPENDED";
  /** null = first pass has never completed (initial check, not an update). */
  lastRunAt: Date | null;
} | null;

export function deriveVerificationPresentation(
  identity: VerificationUxState,
  face: FaceLayerSnapshot,
  opts: {
    workflowStatus?: string | null;
    providerStatus?: string | null;
    /** Owner withdrew face-comparison consent - badge hidden, feature off. */
    consentWithdrawn?: boolean;
  } = {},
): VerificationPresentationState {
  // Consent withdrawal overrides the face-layer refinement: identity stays
  // verified but photo comparison is OFF and the badge is hidden.
  if (
    opts.consentWithdrawn &&
    (identity === "verified" || identity === "requires_reverification")
  ) {
    return "consent_withdrawn";
  }
  // Identity layer first - it gates everything.
  switch (identity) {
    case "not_verified":
      return "not_started";
    case "verification_started":
      return "requires_input";
    case "pending":
      return opts.providerStatus === "processing" ? "processing_identity" : "requires_input";
    case "manual_review":
      return "manual_review";
    case "failed":
      return "failed";
    case "retry_available":
      return opts.workflowStatus === "EXPIRED" ? "expired" : "not_started";
    case "verified":
    case "requires_reverification":
      // Identity is verified in both; requires_reverification additionally
      // means the face layer withheld the badge (photos changed).
      break;
  }

  // Identity verified - the face layer refines the presentation. With the
  // badge withheld (requires_reverification) but no live face job to read,
  // steer to the re-verify prompt rather than falsely presenting "verified".
  if (!face) return identity === "requires_reverification" ? "action_required" : "verified";
  switch (face.status) {
    case "LIVENESS_REQUIRED":
      return "checking_profile_photos"; // capture step (card renders liveness)
    case "QUEUED":
    case "CLAIMED":
    case "CHECKING":
      return face.lastRunAt === null ? "checking_profile_photos" : "photo_update_review";
    case "MANUAL_REVIEW":
    case "SUSPENDED":
      return "manual_review";
    case "REJECTED":
      return "action_required";
    case "AUTO_VERIFIED":
      return "verified";
  }
}

/** User-facing copy for the face-layer states the card renders. */
export const FACE_STATE_COPY = {
  checking_profile_photos: {
    title: "Checking your profile photos",
    body: "Your identity is confirmed. We're making sure your profile photos are really you - this usually takes a moment.",
  },
  photo_update_review: {
    title: "Checking your new photo",
    body: "Your badge stays while we confirm the change. No action needed.",
  },
  action_required: {
    title: "Replace the selected profile photo",
    body: "Your cover photo couldn't be confirmed as you. Choose a clear photo of yourself to keep your verified badge.",
  },
  consent_withdrawn: {
    title: "Photo comparison is turned off",
    body: "Photo comparison is turned off. Your verified badge is hidden. You can enable it again by giving consent and completing profile verification.",
  },
} as const;

// ===========================================================================
// Epic 4 - DUAL-BADGE migration presentation. The ONE canonical read model
// for the two independent trust facts. Every surface (public, owner, admin)
// derives its badges from here - never from raw columns.
//
//   Identity Verified  <- User.photoVerifiedAt   ("this person passed ID")
//   Photo Verified     <- User.faceVerifiedAt    ("these photos are them")
//
// DORMANT-SAFE: faceVerifiedAt is null for everyone (no grants), so every
// existing verified user resolves to IDENTITY_VERIFIED only, and PHOTO_VERIFIED
// is unreachable until the full trust workflow completes. No backfill.
// ===========================================================================

/** The two independent trust facts. */
export type VerificationSubject = {
  /** Identity (Stripe) verdict - the "Identity Verified" source. */
  photoVerifiedAt: Date | null;
  /** Positive Photo-Verified grant (Epic 1) - the "Photo Verified" source. */
  faceVerifiedAt?: Date | null;
};

export function isIdentityVerified(u: VerificationSubject): boolean {
  return u.photoVerifiedAt !== null;
}
export function isPhotoVerifiedBadge(u: VerificationSubject): boolean {
  return (u.faceVerifiedAt ?? null) !== null;
}

/** The single PUBLIC badge: the highest tier earned, else none. Photo Verified
 *  implies identity, so showing only the top tier is honest + unambiguous. */
export type PublicVerificationBadge = "PHOTO_VERIFIED" | "IDENTITY_VERIFIED" | null;
export function publicVerificationBadge(u: VerificationSubject): PublicVerificationBadge {
  if (isPhotoVerifiedBadge(u)) return "PHOTO_VERIFIED";
  if (isIdentityVerified(u)) return "IDENTITY_VERIFIED";
  return null;
}

export const VERIFICATION_BADGE_LABEL: Record<"PHOTO_VERIFIED" | "IDENTITY_VERIFIED", string> = {
  PHOTO_VERIFIED: "Photo verified",
  IDENTITY_VERIFIED: "Identity verified",
};

/** Owner-facing state for the two-badge journey (Phase 4). */
export type OwnerVerificationState =
  | "NOT_VERIFIED"
  | "IDENTITY_VERIFIED"
  | "PHOTO_VERIFIED"
  | "CHECKING"
  | "NEEDS_PHOTO_VERIFICATION"
  | "BINDING_REQUIRED"
  | "CONSENT_REQUIRED"
  | "PROVIDER_UNAVAILABLE";

export type OwnerVerificationPresentation = {
  identityVerified: boolean;
  photoVerified: boolean;
  identity: { title: string; body: string };
  photo: { state: OwnerVerificationState; title: string; body: string; nextAction: string | null };
};

/**
 * Owner presentation. `grantReason` is the optional evaluatePhotoGrant() reason
 * (server-computed); when omitted or the layer is dormant, an identity-verified
 * user simply sees "earn Photo Verified". Pure - no DB.
 */
export function ownerVerificationPresentation(
  u: VerificationSubject,
  grantReason?: string,
): OwnerVerificationPresentation {
  const identityVerified = isIdentityVerified(u);
  const photoVerified = isPhotoVerifiedBadge(u);

  const identity = identityVerified
    ? { title: "Identity Verified", body: "Your identity has been verified." }
    : { title: "Identity not verified", body: "Complete identity verification to get started." };

  let state: OwnerVerificationState;
  let title: string;
  let body: string;
  let nextAction: string | null = null;

  if (photoVerified) {
    state = "PHOTO_VERIFIED";
    title = "Photo Verified";
    body = "Your current photos are confirmed to be you.";
  } else if (!identityVerified) {
    state = "NOT_VERIFIED";
    title = "Photo Verified";
    body = "Verify your identity first, then complete the photo check.";
    nextAction = "Verify identity";
  } else {
    // identity verified, photo not yet - refine by the grant reason if given.
    switch (grantReason) {
      case "UNDER_REVIEW":
        state = "CHECKING";
        title = "Checking your profile photos";
        body = "We're confirming your current photos match your verified identity.";
        break;
      case "CONSENT_REQUIRED":
        state = "CONSENT_REQUIRED";
        title = "Photo Verified";
        body = "Give consent to the face check to continue.";
        nextAction = "Give consent";
        break;
      case "NO_BINDING":
      case "NO_FACE_REFERENCE":
        state = "BINDING_REQUIRED";
        title = "Photo Verified";
        body = "Complete the quick face check to confirm it's you.";
        nextAction = "Start face check";
        break;
      case "NO_MATCH":
        state = "NEEDS_PHOTO_VERIFICATION";
        title = "Photo Verified";
        body =
          "Your current cover photo couldn't be confirmed. Update it to a clear photo of yourself.";
        nextAction = "Update cover photo";
        break;
      case "PROVIDER_UNAVAILABLE":
        state = "PROVIDER_UNAVAILABLE";
        title = "Photo Verified";
        body = "The photo check is temporarily unavailable. Please try again later.";
        break;
      default:
        // dormant / PROVIDER_DISABLED / EMERGENCY / unknown
        state = "IDENTITY_VERIFIED";
        title = "Photo Verified";
        body = "Complete the photo verification process to earn this badge.";
        nextAction = "Learn more";
    }
  }
  return { identityVerified, photoVerified, identity, photo: { state, title, body, nextAction } };
}
