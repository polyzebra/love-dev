import { isFaceMatchConfigured } from "@/lib/services/face-match-providers";
import { faceEmergencyDisabled, faceMatchLegalGate } from "@/lib/services/face-rollout";
import {
  resolveFaceVerificationAction,
  type FaceAction,
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

export function getFaceVerificationAction(input: {
  /** photoVerifiedAt !== null - Stripe identity verified. */
  identityVerified: boolean;
  /** faceBadgeSuspendedAt !== null - the public badge is withheld. */
  badgeSuspended: boolean;
  /** The user's ProfilePhotoVerification row (or null while the layer is dormant). */
  faceJob: FaceJobRow;
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
  });
}
