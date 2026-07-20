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
// L6.7.2 (F-3 closure): the dormant Epic-4 DUAL-BADGE presentation model
// (publicVerificationBadge / isPhotoVerifiedBadge / ownerVerificationPresentation
// / VERIFICATION_BADGE_LABEL and their types) has been REMOVED. It was a second,
// unconsumed public-badge derivation that omitted the suspension + gallery-
// integrity gates - a fork of the Trust Contract. The ONE public badge is
// isPubliclyVerified() (verification.ts) -> publicBadgeVisible()/resolveTrustState()
// (verification-state-machine.ts). Do NOT reintroduce a parallel badge resolver
// here; tests/trust-contract-governance.test.ts fails CI if these names return.
// (Identity-only helpers isIdentityVerified/isPhotoVerified remain canonical in
// verification.ts.)
// ===========================================================================

// ===========================================================================
// L8.3.1 - THE canonical AWS face-verification ACTION resolver.
//
// This is NOT a badge resolver (it never computes badge visibility - that
// stays in verification-state-machine.ts). It answers ONE question that the
// Account AND Profile surfaces must answer identically: given a user's face
// state, what single face-verification action do we offer, and if none, why?
//
// The two distinct actions the surfaces conflated before:
//   - START_LIVENESS: first-time ENROLMENT. No canonical face reference yet -
//     one video-selfie liveness capture links the face to the profile. Happens
//     exactly once per user.
//   - VERIFY_PHOTO:   photo MATCH. A reference already exists - a changed photo
//     is matched against it. NO liveness, ever again.
//
// Requirement 4: the CTA is never silently disabled. When the layer can't run,
// the resolver returns kind:"BLOCKED" with an EXPLICIT blockingReason.
// ===========================================================================

export type FaceActionKind =
  | "IDENTITY_FIRST" // identity not verified yet - the face layer is downstream
  | "START_LIVENESS" // first-time enrolment (no reference) -> real AWS liveness
  | "VERIFY_PHOTO" // reference exists + photo changed -> match only, no liveness
  | "VERIFIED" // enrolled and current - nothing to do
  | "CONSENT_WITHDRAWN" // owner turned face comparison off
  | "BLOCKED"; // cannot run - see blockingReason

export type FaceBlockingReason =
  | "AWS_UNAVAILABLE" // provider not configured (FACE_MATCH_PROVIDER unset / dormant)
  | "LEGAL_GATE_CLOSED" // faceMatchLegalGate() not satisfied
  | "EMERGENCY_DISABLED" // FACE_EMERGENCY_DISABLE kill switch on
  | "REFERENCE_MISSING" // a match is required but the reference is gone (revoked/expired)
  | "ROUTE_NOT_WIRED"; // the liveness API route is absent (build/deploy defect)

/** Everything the pure resolver needs - computed by each surface (server side)
 *  from the SAME canonical sources so the surfaces can never disagree. */
export type FaceActionFacts = {
  /** Stripe identity verified (photoVerifiedAt present). Gates the face layer. */
  identityVerified: boolean;
  /** Public badge currently withheld (faceBadgeSuspendedAt present) - a photo changed. */
  badgeSuspended: boolean;
  /** A usable canonical face reference exists (enrolment already happened). */
  hasReference: boolean;
  /** Owner withdrew face-comparison consent. */
  consentWithdrawn: boolean;
  /** isFaceMatchConfigured() - provider wired. */
  faceLayerConfigured: boolean;
  /** faceMatchLegalGate().ok - compliance approvals present. */
  legalGateOpen: boolean;
  /** faceEmergencyDisabled() - kill switch. */
  emergencyDisabled: boolean;
  /** The liveness API route exists (compile-time invariant; a guard for build defects). */
  routeWired: boolean;
};

export type FaceAction = {
  kind: FaceActionKind;
  /** CTA button label - null when there is no actionable button. */
  label: string | null;
  /** Card headline. Never the bare "Verified badge removed" - always says
   *  whether the user needs first-time enrolment or only a photo match. */
  headline: string;
  body: string;
  /** Populated only for kind:"BLOCKED" - the exact machine reason. */
  blockingReason: FaceBlockingReason | null;
};

const FACE_ACTION_COPY = {
  START_LIVENESS: {
    label: "Start Face Verification",
    headline: "Verify your face - one time only",
    body: "Record a short one-time video selfie to link your face to your profile. After this, new photos are checked automatically - you'll never record another video.",
  },
  VERIFY_PHOTO: {
    label: "Verify New Photo",
    headline: "Confirm your new photo",
    body: "Your profile photo changed, so your badge is paused. We'll match the new photo to the face you already verified - no video needed. Your badge returns the moment it matches.",
  },
  VERIFIED: {
    label: null,
    headline: "Your face is verified",
    body: "New photos are checked automatically against your verified face. Nothing is needed from you.",
  },
  CONSENT_WITHDRAWN: {
    label: null,
    headline: "Photo comparison is turned off",
    body: "Your verified badge is hidden. Turn photo comparison back on and complete verification to restore it.",
  },
  IDENTITY_FIRST: {
    label: null,
    headline: "Verify your identity first",
    body: "Complete identity verification to unlock face verification for your photos.",
  },
} as const;

const BLOCKED_COPY: Record<FaceBlockingReason, { headline: string; body: string }> = {
  AWS_UNAVAILABLE: {
    headline: "Face verification isn't available yet",
    body: "Face verification will open here soon. Your verified badge is unaffected.",
  },
  LEGAL_GATE_CLOSED: {
    headline: "Face verification is being finalised",
    body: "We're completing the compliance review before face verification opens. Your verified badge is unaffected.",
  },
  EMERGENCY_DISABLED: {
    headline: "Face verification is paused",
    body: "Face verification is temporarily paused for maintenance. Your verified badge is unaffected.",
  },
  REFERENCE_MISSING: {
    headline: "Re-verify your face",
    body: "Your saved face reference is no longer valid, so a quick one-time video selfie is needed again before new photos can be matched.",
  },
  ROUTE_NOT_WIRED: {
    headline: "Face verification is unavailable",
    body: "This feature isn't reachable right now. Your verified badge is unaffected.",
  },
};

/**
 * The ONE face-verification action resolver. Pure, fail-closed, side-effect
 * free. Order matters:
 *   1. identity is the prerequisite (no identity -> no face CTA);
 *   2. explicit consent withdrawal is its own state;
 *   3. config/compliance gates block with an EXPLICIT reason (never a silent
 *      disabled button);
 *   4. only then: no reference -> first-time enrolment; reference present ->
 *      photo match if the badge is suspended, else nothing to do.
 *
 * INVARIANT (the task's core guarantee): once `hasReference` is true the
 * resolver NEVER returns START_LIVENESS - a gallery change can only ever
 * produce VERIFY_PHOTO. A second liveness session is structurally impossible.
 */
export function resolveFaceVerificationAction(f: FaceActionFacts): FaceAction {
  const action = (
    kind: Exclude<FaceActionKind, "BLOCKED">,
  ): FaceAction => ({ kind, ...FACE_ACTION_COPY[kind], blockingReason: null });
  const blocked = (blockingReason: FaceBlockingReason): FaceAction => ({
    kind: "BLOCKED",
    label: null,
    ...BLOCKED_COPY[blockingReason],
    blockingReason,
  });

  if (!f.identityVerified) return action("IDENTITY_FIRST");
  if (f.consentWithdrawn) return action("CONSENT_WITHDRAWN");

  // Config/compliance gates - fail closed with the exact reason.
  if (f.emergencyDisabled) return blocked("EMERGENCY_DISABLED");
  if (!f.faceLayerConfigured) return blocked("AWS_UNAVAILABLE");
  if (!f.legalGateOpen) return blocked("LEGAL_GATE_CLOSED");
  if (!f.routeWired) return blocked("ROUTE_NOT_WIRED");

  // Layer live. No reference -> the ONE-TIME enrolment path.
  if (!f.hasReference) return action("START_LIVENESS");

  // Reference exists -> liveness is NEVER offered again. A changed photo is a
  // match; an unchanged, current badge needs nothing.
  if (f.badgeSuspended) return action("VERIFY_PHOTO");
  return action("VERIFIED");
}
