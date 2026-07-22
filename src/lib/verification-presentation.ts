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
  // Pre-camera failures. These are DISTINCT from capture_failed: they mean the
  // session could not even be started, so the AWS camera never ran. Only
  // capture_failed ("lighting or movement") may follow a REAL capture attempt.
  | "start_failed"
  | "network_error"
  // Detector-reported failures BEFORE a usable capture UI (L9.3). Mapped from
  // FaceLivenessDetectorCore's LivenessErrorState so a failure right after the
  // camera prompt is never mislabelled as "lighting or movement".
  | "camera_stream_failed"
  | "liveness_component_failed"
  | "aws_stream_start_failed"
  | "capture_failed"
  // Bounded-poll terminal state (L9.4): the result did not resolve before the
  // hard deadline, so we stop the spinner and offer a retry instead of hanging.
  | "result_timeout"
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
    title: "Get ready",
    body: "Follow the on-screen guide and tap Begin to start the camera check.",
  },
  liveness_processing: {
    title: "Checking it's really you",
    body: "This usually takes a few seconds.",
  },
  start_failed: {
    title: "We couldn't start the check",
    body: "Something went wrong before the camera opened. This is on our side, not your photos - please try again in a moment.",
  },
  network_error: {
    title: "Connection problem",
    body: "We couldn't reach Tirvea to start the check. Check your connection and try again.",
  },
  camera_stream_failed: {
    title: "Couldn't start your camera",
    body: "Your camera didn't start. Close other apps that might be using it, then tap Try again.",
  },
  liveness_component_failed: {
    title: "The check couldn't start",
    body: "Something went wrong starting the camera check before it could run. This isn't about your photos - please try again.",
  },
  aws_stream_start_failed: {
    title: "Couldn't connect the check",
    body: "We couldn't reach the verification service to start the check. Check your connection and try again.",
  },
  capture_failed: {
    title: "That didn't work",
    body: "The check couldn't be completed - lighting or movement is the usual cause. You can try again right away.",
  },
  result_timeout: {
    title: "We couldn't finish verification",
    body: "Your video may have been submitted, but the result isn't available yet. Try again, or contact support if this keeps happening.",
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
    title: "Video verification complete",
    body: "We're checking your profile photo now. You don't need to record another video - this page updates automatically.",
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

// L8.3.3: the canonical verification STATUS. One machine state per distinct
// thing the user must understand (what happened / what's happening / what to
// do / when nothing is required). Every status carries exact copy + a real CTA.
export type FaceActionStatus =
  | "IDENTITY_FIRST" // identity not verified yet - the face layer is downstream
  | "FIRST_TIME" // no canonical reference -> one-time enrolment (AWS liveness)
  | "PROCESSING" // a changed photo is being matched (spinner, no CTA)
  | "MATCH_FAILED" // the photo could not be confirmed as the verified face
  | "NO_FACE" // no face detected in a required (cover) photo
  | "MULTIPLE_FACES" // more than one face in the photo
  | "MANUAL_REVIEW" // a human is reviewing the photo
  | "VERIFIED" // enrolled and current - nothing required
  | "CONSENT_WITHDRAWN" // owner turned face comparison off
  | "UNAVAILABLE"; // the layer can't run - see blockingReason (Retry)

/** The per-photo check outcome once a canonical reference exists. Drives the
 *  PROCESSING / *_FAILED / NO_FACE / MULTIPLE_FACES / MANUAL_REVIEW statuses. */
export type FacePhotoOutcome =
  | "NONE" // no photo change pending / nothing to report
  | "PROCESSING" // AWS face match in flight
  | "MATCH_FAILED" // matched against the reference and failed
  | "NO_FACE" // detector found no face
  | "MULTIPLE_FACES" // detector found more than one face
  | "MANUAL_REVIEW"; // routed to human review

/** The real action a CTA performs (never a dead navigation). */
export type FaceCtaAction =
  | "START_LIVENESS" // -> AWS Face Liveness (one-time enrolment)
  | "VERIFY_PHOTO" // -> AWS Face Match (existing reference)
  | "REPLACE_PHOTO" // -> the photo picker
  | "RETRY"; // -> restart verification

export type FaceBlockingReason =
  | "AWS_UNAVAILABLE" // provider not configured (FACE_MATCH_PROVIDER unset / dormant)
  | "LEGAL_GATE_CLOSED" // faceMatchLegalGate() not satisfied
  | "EMERGENCY_DISABLED" // FACE_EMERGENCY_DISABLE kill switch on
  | "REFERENCE_MISSING" // a match is required but the reference is gone (revoked/expired)
  | "ROUTE_NOT_WIRED"; // the liveness API route is absent (build/deploy defect)

/** Everything the pure resolver needs - computed by each surface (server side)
 *  from the SAME canonical sources so the surfaces can never disagree. */
export type FaceActionFacts = {
  /**
   * L9.1.2: the user is a REGISTERED account (email + phone + legal + onboarding
   * complete) and therefore eligible to do AWS Face Liveness. This is NOT Stripe
   * identity - AWS liveness is an OPTIONAL verification available to any
   * registered user regardless of Stripe (`photoVerifiedAt`). Stripe stays a
   * separate optional action for the Blue Badge only.
   */
  eligible: boolean;
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
  /** L8.3.3: the current per-photo check outcome (once a reference exists). */
  photoOutcome: FacePhotoOutcome;
};

/**
 * THE canonical verification UX object both Account and Profile render. Never a
 * generic/consequence message ("Verified badge removed", "Verify Photos") -
 * always: what happened + what's happening + what to do + when nothing is needed.
 */
export type FaceAction = {
  status: FaceActionStatus;
  /** What happened / what to do - the primary line. */
  headline: string;
  /** The supporting explanation. */
  description: string;
  /** The one real action, or null when nothing is required. The label is what
   *  the button reads; the action is what it EXECUTES (never a dead nav). */
  cta: { label: string; action: FaceCtaAction } | null;
  /** Populated only for status:"UNAVAILABLE" - the exact machine reason. */
  blockingReason: FaceBlockingReason | null;
  /** Progress indicator - spinner visible while a check is in flight. */
  progress: { spinner: boolean };
};

// L8.3.3 EXACT copy per status. Governance pins these strings, so the UI can
// never regress to a generic/consequence message. `cta.action` is what the
// button EXECUTES; `spinner` feeds the progress indicator.
type FaceUx = {
  headline: string;
  description: string;
  cta: { label: string; action: FaceCtaAction } | null;
  spinner: boolean;
};

const FACE_ACTION_UX: Record<FaceActionStatus, FaceUx> = {
  IDENTITY_FIRST: {
    headline: "Finish setting up your account",
    description: "Complete registration to unlock face verification.",
    cta: null,
    spinner: false,
  },
  FIRST_TIME: {
    headline: "Complete Face Verification",
    description:
      "Complete a quick one-time face verification before you can start dating. This usually takes about 10 seconds. No ID document is required.",
    cta: { label: "Start Face Verification", action: "START_LIVENESS" },
    spinner: false,
  },
  PROCESSING: {
    headline: "Checking your new photo",
    description:
      "We're comparing your new photo with your verified face. No additional face verification is required.",
    cta: null,
    spinner: true,
  },
  MATCH_FAILED: {
    headline: "This photo couldn't be verified",
    description: "Choose another photo showing your face clearly.",
    cta: { label: "Replace Photo", action: "REPLACE_PHOTO" },
    spinner: false,
  },
  NO_FACE: {
    headline: "No face detected",
    description: "Your cover photo must clearly show your face.",
    cta: { label: "Choose Another Photo", action: "REPLACE_PHOTO" },
    spinner: false,
  },
  MULTIPLE_FACES: {
    headline: "Multiple faces detected",
    description: "Use a photo that only shows you.",
    cta: { label: "Replace Photo", action: "REPLACE_PHOTO" },
    spinner: false,
  },
  MANUAL_REVIEW: {
    headline: "Photo under review",
    description: "We'll notify you when the review is complete.",
    cta: null,
    spinner: false,
  },
  VERIFIED: {
    headline: "Your face is verified",
    description:
      "New photos are checked automatically against your verified face. Nothing is needed from you.",
    cta: null,
    spinner: false,
  },
  CONSENT_WITHDRAWN: {
    headline: "Photo comparison is turned off",
    description:
      "Turn photo comparison back on and complete verification to restore your verified badge.",
    cta: null,
    spinner: false,
  },
  UNAVAILABLE: {
    headline: "Verification temporarily unavailable",
    description: "Please try again later.",
    cta: { label: "Retry", action: "RETRY" },
    spinner: false,
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
 * resolver NEVER returns FIRST_TIME (whose CTA is the one-time liveness) - a
 * gallery change can only ever produce PROCESSING / a failure state. A second
 * liveness session is structurally impossible.
 */
export function resolveFaceVerificationAction(f: FaceActionFacts): FaceAction {
  const make = (
    status: FaceActionStatus,
    blockingReason: FaceBlockingReason | null = null,
  ): FaceAction => {
    const u = FACE_ACTION_UX[status];
    return {
      status,
      headline: u.headline,
      description: u.description,
      cta: u.cta,
      blockingReason,
      progress: { spinner: u.spinner },
    };
  };

  if (!f.eligible) return make("IDENTITY_FIRST");
  if (f.consentWithdrawn) return make("CONSENT_WITHDRAWN");

  // Config/compliance gates - one honest "temporarily unavailable" surface, the
  // exact machine reason retained for telemetry. CTA: Retry (restart).
  if (f.emergencyDisabled) return make("UNAVAILABLE", "EMERGENCY_DISABLED");
  if (!f.faceLayerConfigured) return make("UNAVAILABLE", "AWS_UNAVAILABLE");
  if (!f.legalGateOpen) return make("UNAVAILABLE", "LEGAL_GATE_CLOSED");
  if (!f.routeWired) return make("UNAVAILABLE", "ROUTE_NOT_WIRED");

  // Layer live. No reference -> the ONE-TIME enrolment path.
  if (!f.hasReference) return make("FIRST_TIME");

  // Reference exists -> liveness is NEVER offered again. The per-photo outcome
  // drives exactly what the user sees; a changed-but-unreported photo reads as
  // "checking"; a settled gallery needs nothing.
  switch (f.photoOutcome) {
    case "PROCESSING":
      return make("PROCESSING");
    case "NO_FACE":
      return make("NO_FACE");
    case "MULTIPLE_FACES":
      return make("MULTIPLE_FACES");
    case "MATCH_FAILED":
      return make("MATCH_FAILED");
    case "MANUAL_REVIEW":
      return make("MANUAL_REVIEW");
    case "NONE":
    default:
      return f.badgeSuspended ? make("PROCESSING") : make("VERIFIED");
  }
}
