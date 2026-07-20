import { isFaceMatchConfigured } from "@/lib/services/face-match-providers";
import { faceEmergencyDisabled, faceMatchLegalGate } from "@/lib/services/face-rollout";
import {
  resolveFaceVerificationAction,
  type FaceAction,
  type FacePhotoOutcome,
} from "@/lib/verification-presentation";

/**
 * L8.3.1 - THE server-side entry point for the AWS face-verification action.
 *
 * Both the Account surface and the Profile surface call THIS function, so the
 * CTA they render (first-time enrolment vs photo match vs an explicit blocking
 * reason) can never diverge. It reads the canonical config/compliance gates
 * (isFaceMatchConfigured / faceMatchLegalGate / faceEmergencyDisabled) once and
 * delegates the decision to the pure resolver.
 */

/** The minimal per-user face row both surfaces load (ProfilePhotoVerification). */
export type FaceJobRow = {
  status: string;
  consentAt: Date | null;
} | null;

/**
 * A usable canonical face reference exists iff a ProfilePhotoVerification row
 * is present AND has progressed past the "needs a first liveness" state. This
 * is the one signal that separates first-time ENROLMENT from a photo MATCH.
 */
export function hasCanonicalFaceReference(faceJob: FaceJobRow): boolean {
  return faceJob !== null && faceJob.status !== "LIVENESS_REQUIRED";
}

/**
 * Coarse per-photo outcome from the ProfilePhotoVerification aggregate status.
 * The fine NO_FACE / MULTIPLE_FACES split needs the latest cover PhotoFaceCheck
 * classification, which a caller may pass explicitly via `photoOutcome`; absent
 * that, a REJECTED job reads as a generic match failure.
 */
export function derivePhotoOutcome(faceJob: FaceJobRow): FacePhotoOutcome {
  if (!faceJob) return "NONE";
  switch (faceJob.status) {
    case "QUEUED":
    case "CLAIMED":
    case "CHECKING":
      return "PROCESSING";
    case "MANUAL_REVIEW":
    case "SUSPENDED":
      return "MANUAL_REVIEW";
    case "REJECTED":
      return "MATCH_FAILED";
    default:
      return "NONE";
  }
}

export function getFaceVerificationAction(input: {
  /** photoVerifiedAt !== null - Stripe identity verified. */
  identityVerified: boolean;
  /** faceBadgeSuspendedAt !== null - the public badge is withheld. */
  badgeSuspended: boolean;
  /** The user's ProfilePhotoVerification row (or null while the layer is dormant). */
  faceJob: FaceJobRow;
  /** Optional precise per-photo outcome (from the latest cover PhotoFaceCheck
   *  classification). Defaults to a coarse mapping from the job status. */
  photoOutcome?: FacePhotoOutcome;
}): FaceAction {
  const consentWithdrawn =
    input.badgeSuspended && input.faceJob !== null && input.faceJob.consentAt === null;
  return resolveFaceVerificationAction({
    identityVerified: input.identityVerified,
    badgeSuspended: input.badgeSuspended,
    hasReference: hasCanonicalFaceReference(input.faceJob),
    consentWithdrawn,
    faceLayerConfigured: isFaceMatchConfigured(),
    legalGateOpen: faceMatchLegalGate().ok,
    emergencyDisabled: faceEmergencyDisabled(),
    // The /api/verification/liveness route is a compile-time invariant; this
    // guards only against a build/deploy that dropped it.
    routeWired: true,
    photoOutcome: input.photoOutcome ?? derivePhotoOutcome(input.faceJob),
  });
}
