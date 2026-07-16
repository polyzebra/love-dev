import type { FaceCheckClassification } from "@/generated/prisma/client";
import { FaceMatchNotConfiguredError } from "@/lib/services/face-match-providers";
import {
  ProviderCircuitOpenError,
  classifyProviderFailure,
} from "@/lib/services/provider-resilience";

/**
 * CANONICAL normalized face outcomes - the internal vocabulary the whole
 * app reasons in. It is a mapping layer, NOT a schema change: the database
 * keeps the existing FaceCheckClassification / FaceCheckDecision enums
 * (backward-compatible), and this module maps those - plus the error /
 * provider-unavailable states the DB enums cannot represent - into one
 * stable set with structured reason codes.
 *
 * Rules encoded here (see the per-value docs + POLICY constants):
 *  - a provider error is NEVER a mismatch (-> PROVIDER_UNAVAILABLE / ERROR);
 *  - LOW_CONFIDENCE goes to manual review;
 *  - MULTIPLE_FACES on a cover -> manual review (the ONE documented policy);
 *  - AI_OR_MANIPULATION_RISK never auto-bans (badge withheld + appealable);
 *  - a NO_FACE extra gallery photo may be ignored; a NO_FACE cover cannot
 *    keep badge confidence;
 *  - a DIFFERENT_PERSON cover suspends the badge.
 *
 * These outcomes + reason codes are INTERNAL. Public surfaces expose only
 * the boolean badge (isPubliclyVerified) - never a score or a reason code.
 */
export type NormalizedFaceOutcome =
  | "OWNER_MATCHED"
  | "DIFFERENT_PERSON"
  | "NO_FACE"
  | "MULTIPLE_FACES"
  | "LOW_CONFIDENCE"
  | "AI_OR_MANIPULATION_RISK"
  | "PROVIDER_UNAVAILABLE"
  | "ERROR";

/** Structured reason codes - a superset of the stored failureReason strings
 *  plus the error/unavailable reasons. Safe for admin/audit; never public. */
export type FaceReasonCode =
  | "owner_confirmed"
  | "cover_other_person"
  | "gallery_other_person"
  | "cover_no_face"
  | "gallery_no_face_allowed"
  | "cover_multiple_faces"
  | "cover_uncertain"
  | "gallery_uncertain"
  | "manipulation_suspected"
  | "image_unreadable"
  | "provider_unavailable"
  | "provider_not_configured"
  | "internal_error";

/**
 * THE documented policy for a cover photo that contains multiple faces:
 * route to MANUAL_REVIEW (a human decides), never an automatic suspension.
 * A group cover is ambiguous, not proof of impersonation.
 */
export const MULTIPLE_FACES_ON_COVER_POLICY = "MANUAL_REVIEW" as const;

/** Map a stored DB classification (the success path) -> normalized outcome. */
export function classificationToOutcome(c: FaceCheckClassification): NormalizedFaceOutcome {
  switch (c) {
    case "OWNER_MATCHED":
      return "OWNER_MATCHED";
    case "OTHER_PERSON_ONLY":
      return "DIFFERENT_PERSON";
    case "NO_FACE":
      return "NO_FACE";
    case "GROUP_PHOTO":
      return "MULTIPLE_FACES";
    case "UNCERTAIN":
      return "LOW_CONFIDENCE";
    case "MANIPULATION_RISK":
      return "AI_OR_MANIPULATION_RISK";
  }
}

/**
 * Map a thrown provider/run error -> normalized outcome + reason code. A
 * provider outage, timeout, circuit-open, throttle, credential or region
 * failure is a PROVIDER problem, NEVER a mismatch - so it maps to
 * PROVIDER_UNAVAILABLE (the caller must keep the previous badge and retry).
 * Only a genuinely unexpected error maps to ERROR. Neither ever suspends a
 * badge or fabricates a rejection.
 */
export function providerErrorToOutcome(error: unknown): {
  outcome: "PROVIDER_UNAVAILABLE" | "ERROR";
  reasonCode: FaceReasonCode;
} {
  if (error instanceof FaceMatchNotConfiguredError) {
    return { outcome: "PROVIDER_UNAVAILABLE", reasonCode: "provider_not_configured" };
  }
  if (error instanceof ProviderCircuitOpenError) {
    return { outcome: "PROVIDER_UNAVAILABLE", reasonCode: "provider_unavailable" };
  }
  // timeout | credential | throttle | quota | network | regional are all
  // provider/infra conditions - transient or config, never a face verdict.
  return classifyProviderFailure(error) === "unknown"
    ? { outcome: "ERROR", reasonCode: "internal_error" }
    : { outcome: "PROVIDER_UNAVAILABLE", reasonCode: "provider_unavailable" };
}

/** True for outcomes that must NEVER change the badge (retry instead). */
export function isTransientOutcome(o: NormalizedFaceOutcome): boolean {
  return o === "PROVIDER_UNAVAILABLE" || o === "ERROR";
}
