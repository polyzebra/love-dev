/**
 * L10.0 - THE canonical verification-progress timeline (presentation only).
 *
 * One source of truth for the polished, SaaS-style verification experience: a
 * 5-step timeline (email -> phone -> video -> profile-photo review -> verified),
 * a single state-aware status card, and the state-aware CTA label. It maps the
 * EXISTING canonical verification state (never re-derives trust) into what the UI
 * shows, so every surface tells the same story. Pure + deterministic - no DB, no
 * network, no side effects. Backend/security/thresholds are NOT touched here.
 */

/** The canonical stage of the identity+photo verification journey. Derived from
 *  the existing resolvers (deriveVerificationPresentation / getFaceVerificationAction /
 *  deriveVerificationUxState) - never recomputed from raw rows. */
export type VerificationStage =
  | "NOT_STARTED" // eligible, no video done yet
  | "RECORDING" // liveness capture is live (client-only)
  | "CHECKING_PHOTOS" // video done + reference enrolled; profile-photo check running
  | "MANUAL_REVIEW" // a human is reviewing the profile photos
  | "VERIFIED" // fully verified (badge live)
  | "ACTION_REQUIRED" // a photo was rejected - user must replace it
  | "EXPIRED" // the session lapsed - start again
  | "UNAVAILABLE"; // the layer can't run (dormant/blocked) - quiet state

export type TimelineStepStatus = "done" | "active" | "pending";

export type TimelineStep = {
  key: "email" | "phone" | "video" | "photos" | "verified";
  label: string;
  status: TimelineStepStatus;
};

/** Tone drives the card's colour register (icon + accent), never colour alone. */
export type CardTone = "progress" | "review" | "success" | "action" | "idle";

export type TimelineCard = {
  tone: CardTone;
  title: string;
  body: string;
  /** Whether to show an animated in-progress indicator (spinner). */
  spinner: boolean;
  /** Primary action, or null. `action` is a stable machine token the surface maps. */
  cta: { label: string; action: "START_LIVENESS" | "REPLACE_PHOTO" | "RETRY" | "LEARN_MORE" } | null;
};

export type VerificationTimeline = {
  steps: TimelineStep[];
  card: TimelineCard;
  /** State-aware label for the compact verification ROW (Phase B) - never
   *  "Verify" once the process has already moved past NOT_STARTED. */
  rowLabel: string;
};

export type TimelineFacts = {
  emailVerified: boolean;
  phoneVerified: boolean;
  stage: VerificationStage;
};

/** Video step is complete once we are at/after the photo-check stage. */
function videoDone(stage: VerificationStage): boolean {
  return (
    stage === "CHECKING_PHOTOS" ||
    stage === "MANUAL_REVIEW" ||
    stage === "VERIFIED" ||
    stage === "ACTION_REQUIRED"
  );
}

function buildSteps(f: TimelineFacts): TimelineStep[] {
  const { stage } = f;
  const email: TimelineStepStatus = f.emailVerified ? "done" : "active";
  const phone: TimelineStepStatus = f.phoneVerified
    ? "done"
    : f.emailVerified
      ? "active"
      : "pending";

  let video: TimelineStepStatus;
  if (videoDone(stage)) video = "done";
  else if (stage === "RECORDING") video = "active";
  else if (f.phoneVerified) video = "active";
  else video = "pending";

  let photos: TimelineStepStatus;
  if (stage === "VERIFIED") photos = "done";
  else if (stage === "CHECKING_PHOTOS" || stage === "MANUAL_REVIEW" || stage === "ACTION_REQUIRED")
    photos = "active";
  else photos = "pending";

  const verified: TimelineStepStatus = stage === "VERIFIED" ? "done" : "pending";

  // Exactly one "active" step: the first non-done step. Collapse extra actives.
  const steps: TimelineStep[] = [
    { key: "email", label: "Email verified", status: email },
    { key: "phone", label: "Phone verified", status: phone },
    { key: "video", label: "Video verification", status: video },
    { key: "photos", label: "Profile photos", status: photos },
    { key: "verified", label: "Verified", status: verified },
  ];
  let activeSeen = false;
  for (const s of steps) {
    if (s.status === "done") continue;
    if (!activeSeen && s.status === "active") {
      activeSeen = true;
    } else if (s.status === "active") {
      s.status = "pending"; // only ONE current step may be active
    }
  }
  return steps;
}

function buildCard(stage: VerificationStage): TimelineCard {
  switch (stage) {
    case "CHECKING_PHOTOS":
      return {
        tone: "progress",
        title: "Video verification complete",
        body: "Your identity video has been successfully processed. We're now reviewing your profile photos - you don't need to record another video. We'll update this page as soon as it's done.",
        spinner: true,
        cta: null,
      };
    case "MANUAL_REVIEW":
      return {
        tone: "review",
        title: "Profile review in progress",
        body: "Sometimes we manually review profile photos to keep Tirvea safe. No action is needed from you - this usually completes within 24 hours, and we'll let you know the moment it's done.",
        spinner: true,
        cta: { label: "Learn more", action: "LEARN_MORE" },
      };
    case "VERIFIED":
      return {
        tone: "success",
        title: "Verified",
        body: "Your identity and profile photos have been successfully verified. Your verified badge is now live on your profile.",
        spinner: false,
        cta: null,
      };
    case "ACTION_REQUIRED":
      return {
        tone: "action",
        title: "One photo needs replacing",
        body: "One of your photos couldn't be matched to your video. Replace it with a clear photo that shows your face - you don't need to record another video.",
        spinner: false,
        cta: { label: "Replace photo", action: "REPLACE_PHOTO" },
      };
    case "EXPIRED":
      return {
        tone: "action",
        title: "Verification expired",
        body: "Your verification session lapsed before it finished. Start again whenever you're ready - it only takes about ten seconds.",
        spinner: false,
        cta: { label: "Start again", action: "START_LIVENESS" },
      };
    case "RECORDING":
      return {
        tone: "progress",
        title: "Recording your video",
        body: "Follow the on-screen guide to complete your quick video check.",
        spinner: true,
        cta: null,
      };
    case "UNAVAILABLE":
      return {
        tone: "idle",
        title: "Verification temporarily unavailable",
        body: "Photo verification isn't available right now. Please try again later.",
        spinner: false,
        cta: null,
      };
    case "NOT_STARTED":
    default:
      return {
        tone: "idle",
        title: "Get verified",
        body: "Complete a quick one-time video check so people know you're really you. It takes about ten seconds and no ID document is required.",
        spinner: false,
        cta: { label: "Start verification", action: "START_LIVENESS" },
      };
  }
}

/** Phase B: state-aware label for the compact verification row. NEVER "Verify"
 *  once the flow has moved past NOT_STARTED. */
function rowLabelFor(stage: VerificationStage): string {
  switch (stage) {
    case "RECORDING":
      return "Recording…";
    case "CHECKING_PHOTOS":
      return "Checking photos…";
    case "MANUAL_REVIEW":
      return "Under review";
    case "VERIFIED":
      return "Verified";
    case "ACTION_REQUIRED":
      return "Action required";
    case "EXPIRED":
      return "Start again";
    case "UNAVAILABLE":
      return "Unavailable";
    case "NOT_STARTED":
    default:
      return "Verify";
  }
}

export function resolveVerificationTimeline(f: TimelineFacts): VerificationTimeline {
  return {
    steps: buildSteps(f),
    card: buildCard(f.stage),
    rowLabel: rowLabelFor(f.stage),
  };
}

/**
 * Map the EXISTING canonical verification state onto the timeline stage. Pure
 * string inputs (no trust re-derivation): the outputs of the shared resolvers.
 * Precedence: verified > action-required > manual-review > checking > unavailable
 * > expired > recording > not-started.
 */
export function deriveVerificationStage(input: {
  /** verificationUx (deriveVerificationUxState): "verified" | "manual_review" | "expired" | ... */
  verificationUx: string;
  /** facePresentation (deriveVerificationPresentation) or null. */
  facePresentation: string | null;
  /** faceAction.status (getFaceVerificationAction). */
  faceActionStatus: string;
  /** Client-only: the live capture is running. */
  recording?: boolean;
}): VerificationStage {
  const { verificationUx, facePresentation, faceActionStatus } = input;
  if (verificationUx === "verified" || faceActionStatus === "VERIFIED") return "VERIFIED";
  if (
    facePresentation === "action_required" ||
    faceActionStatus === "MATCH_FAILED" ||
    faceActionStatus === "NO_FACE" ||
    faceActionStatus === "MULTIPLE_FACES"
  ) {
    return "ACTION_REQUIRED";
  }
  if (
    facePresentation === "manual_review" ||
    faceActionStatus === "MANUAL_REVIEW" ||
    verificationUx === "manual_review"
  ) {
    return "MANUAL_REVIEW";
  }
  if (
    facePresentation === "checking_profile_photos" ||
    facePresentation === "photo_update_review" ||
    faceActionStatus === "PROCESSING"
  ) {
    return "CHECKING_PHOTOS";
  }
  if (faceActionStatus === "UNAVAILABLE") return "UNAVAILABLE";
  if (verificationUx === "expired") return "EXPIRED";
  if (input.recording) return "RECORDING";
  return "NOT_STARTED";
}
