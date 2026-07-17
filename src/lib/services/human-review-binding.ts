import {
  type FaceBindingProvider,
  type FaceBindingMethod,
  type BindingContext,
  type BindingOutcome,
  type BindingHealth,
  BINDING_STATUS,
  FaceBindingEngine,
  getBindingProvider,
  registerBindingProviderFactory,
  bindingMethodFromEnv,
} from "@/lib/services/face-binding";
import { faceBindingLegalGate } from "@/lib/services/face-rollout";

/**
 * Epic 3 - the FIRST real FaceBindingProvider: HUMAN_REVIEW.
 *
 * It answers exactly ONE question via an authorized human: "is the person in
 * the Tirvea liveness evidence the same person who completed Stripe Identity?"
 * The provider NEVER makes a biometric decision and NEVER produces BOUND on its
 * own - createBinding only parks the binding in MANUAL_REVIEW. Only an
 * authorized reviewer, through FaceBindingEngine.completeReview(), can reach
 * BOUND. A BOUND binding proves identity<->face binding ONLY; it does not grant
 * Photo Verified (a current cover MATCH is still required - see
 * face-binding-review.ts + grantPhotoVerification).
 *
 * DORMANT unless configured AND legally approved:
 *   FACE_BINDING_METHOD=HUMAN_REVIEW  AND  FACE_BINDING_LEGAL_APPROVAL_VERSION set.
 * Otherwise humanReviewConfigured() is false, the registry factory returns
 * null, and the engine returns NOT_IMPLEMENTED. Server-only.
 */

/** Configured + legally approved to run human binding review. Dormant default. */
export function humanReviewConfigured(): boolean {
  if (bindingMethodFromEnv() !== "HUMAN_REVIEW") return false;
  // H4: production requires the FULL recorded binding compliance set (the
  // match-layer legal/DPA/calibration gates PLUS a counsel-approved,
  // allow-listed binding version, emergency OFF). Non-production keeps the
  // lightweight dev/rehearsal gate (a supplied version string) so mock lanes
  // and the internal rehearsal continue to run.
  if (process.env.NODE_ENV === "production") return faceBindingLegalGate().ok;
  return Boolean(process.env.FACE_BINDING_LEGAL_APPROVAL_VERSION?.trim());
}

/** Canonical, structured review reason codes (Phase 5). No free-text verdicts. */
export const BindingReviewReason = {
  // decision = BOUND
  SAME_PERSON_CONFIRMED: "SAME_PERSON_CONFIRMED",
  SAME_PERSON_CONFIRMED_WITH_LIMITATIONS: "SAME_PERSON_CONFIRMED_WITH_LIMITATIONS",
  // decision = BINDING_FAILED
  DIFFERENT_PERSON: "DIFFERENT_PERSON",
  IDENTITY_EVIDENCE_MISMATCH: "IDENTITY_EVIDENCE_MISMATCH",
  LIVENESS_EVIDENCE_MISMATCH: "LIVENESS_EVIDENCE_MISMATCH",
  // decision = REQUEST_NEW_CAPTURE / unresolved
  INSUFFICIENT_IMAGE_QUALITY: "INSUFFICIENT_IMAGE_QUALITY",
  FACE_OBSCURED: "FACE_OBSCURED",
  MULTIPLE_PEOPLE: "MULTIPLE_PEOPLE",
  EVIDENCE_UNAVAILABLE: "EVIDENCE_UNAVAILABLE",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  CONSENT_NOT_ACTIVE: "CONSENT_NOT_ACTIVE",
} as const;
export type BindingReviewReason = (typeof BindingReviewReason)[keyof typeof BindingReviewReason];

export const BOUND_REASONS: readonly string[] = [
  BindingReviewReason.SAME_PERSON_CONFIRMED,
  BindingReviewReason.SAME_PERSON_CONFIRMED_WITH_LIMITATIONS,
];
export const FAILED_REASONS: readonly string[] = [
  BindingReviewReason.DIFFERENT_PERSON,
  BindingReviewReason.IDENTITY_EVIDENCE_MISMATCH,
  BindingReviewReason.LIVENESS_EVIDENCE_MISMATCH,
];
export const NEW_CAPTURE_REASONS: readonly string[] = [
  BindingReviewReason.INSUFFICIENT_IMAGE_QUALITY,
  BindingReviewReason.FACE_OBSCURED,
  BindingReviewReason.MULTIPLE_PEOPLE,
  BindingReviewReason.EVIDENCE_UNAVAILABLE,
  BindingReviewReason.PROVIDER_UNAVAILABLE,
  BindingReviewReason.CONSENT_NOT_ACTIVE,
];

/**
 * The provider. It performs NO biometric comparison - createBinding hands the
 * case to human review (MANUAL_REVIEW). The engine owns all status writes.
 */
export class HumanReviewBindingProvider implements FaceBindingProvider {
  readonly method: FaceBindingMethod = "HUMAN_REVIEW";

  /** No automatic decision - park for a human. */
  async createBinding(): Promise<BindingOutcome> {
    return { status: BINDING_STATUS.MANUAL_REVIEW, similarityBand: null };
  }

  /** Human review has no machine state; it stays under review until decided. */
  async getBinding(): Promise<BindingOutcome | null> {
    return { status: BINDING_STATUS.MANUAL_REVIEW };
  }
  async refreshBinding(): Promise<BindingOutcome> {
    return { status: BINDING_STATUS.MANUAL_REVIEW };
  }
  async invalidateBinding(): Promise<void> {
    // Provider-side has no external state; engine lifecycle owns invalidation.
  }
  async deleteBinding(): Promise<void> {
    // No provider-side review state to delete; engine cleanup handles the row.
  }
  async health(): Promise<BindingHealth> {
    return {
      available: humanReviewConfigured(),
      detail: humanReviewConfigured() ? "configured" : "not configured / not legally approved",
    };
  }
}

export const humanReviewBindingProvider = new HumanReviewBindingProvider();

// Self-register the PRODUCTION factory. It returns the provider ONLY when
// configured + legally approved; null otherwise -> dormant. Importing this
// module does not enable anything.
registerBindingProviderFactory("HUMAN_REVIEW", () =>
  humanReviewConfigured() ? humanReviewBindingProvider : null,
);

/**
 * Kick off a human binding review for a freshly enrolled reference: request
 * the binding then run it through the provider so it lands in MANUAL_REVIEW and
 * appears in the admin queue. No-op (returns null) unless HUMAN_REVIEW is the
 * configured, approved method. Never produces BOUND.
 */
export async function requestHumanReviewBinding(ctx: BindingContext): Promise<string | null> {
  if (!humanReviewConfigured()) return null;
  if (!getBindingProvider("HUMAN_REVIEW")) return null;
  const req = await FaceBindingEngine.requestBinding(ctx, "HUMAN_REVIEW");
  if (!req.bindingId) return null;
  await FaceBindingEngine.processBinding(req.bindingId); // -> MANUAL_REVIEW
  return req.bindingId;
}
