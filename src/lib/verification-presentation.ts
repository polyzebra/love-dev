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
  opts: { workflowStatus?: string | null; providerStatus?: string | null } = {},
): VerificationPresentationState {
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
      break;
  }

  // Identity verified - the face layer refines the presentation.
  if (!face) return "verified";
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
} as const;
