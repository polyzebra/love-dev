import { db } from "@/lib/db";
import { isFaceMatchConfigured } from "@/lib/services/face-match-providers";
import { faceEmergencyDisabled } from "@/lib/services/face-rollout";
import {
  recordVerificationAudit,
  BIOMETRIC_CONSENT_VERSION,
} from "@/lib/services/face-verification";

/**
 * Epic 1 / F2 - the ONE canonical positive "Photo Verified" grant engine.
 *
 * It is the SOLE writer of User.faceVerifiedAt. No other code path may set,
 * update, or clear it. faceVerifiedAt is the positive projection behind the
 * future isPhotoVerified() badge (verification.ts) - it is INERT today:
 *   - the grant only fires when EVERY condition passes, and one of them
 *     (BOUND identity<->liveness binding) is never produced yet (Epic 2), so
 *     in production evaluatePhotoGrant() always returns NOT-ELIGIBLE and
 *     faceVerifiedAt stays NULL;
 *   - nothing in production calls grantPhotoVerification() yet;
 *   - the legacy public badge (isPubliclyVerified / faceBadgeSuspendedAt) is
 *     UNCHANGED and independent of this engine.
 *
 * SERVER-ONLY: it imports @/lib/db (server) and must never be pulled into a
 * client bundle. (No `import "server-only"` guard: the repo's tsx test lane
 * has no react-server condition and that guard would throw there.)
 * Reason codes are canonical enums, never inline strings.
 */

/** Structured eligibility outcomes (never hardcode these strings elsewhere). */
export const PhotoGrantReason = {
  NOT_IDENTITY_VERIFIED: "NOT_IDENTITY_VERIFIED",
  NO_FACE_REFERENCE: "NO_FACE_REFERENCE",
  NO_BINDING: "NO_BINDING",
  NO_MATCH: "NO_MATCH",
  CONSENT_REQUIRED: "CONSENT_REQUIRED",
  CONSENT_WITHDRAWN: "CONSENT_WITHDRAWN",
  UNDER_REVIEW: "UNDER_REVIEW",
  PROVIDER_DISABLED: "PROVIDER_DISABLED",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  EMERGENCY_DISABLED: "EMERGENCY_DISABLED",
  ELIGIBLE: "ELIGIBLE",
} as const;
export type PhotoGrantReason = (typeof PhotoGrantReason)[keyof typeof PhotoGrantReason];

/** Why a grant was cleared. Every clear is audited with one of these. */
export const PhotoClearReason = {
  PHOTO_CHANGED: "PHOTO_CHANGED",
  CONSENT_WITHDRAWN: "CONSENT_WITHDRAWN",
  REFERENCE_ROTATED: "REFERENCE_ROTATED",
  REFERENCE_DELETED: "REFERENCE_DELETED",
  BINDING_FAILED: "BINDING_FAILED",
  MANUAL_REVIEW: "MANUAL_REVIEW",
  PROVIDER_DISABLED: "PROVIDER_DISABLED",
  ACCOUNT_DELETED: "ACCOUNT_DELETED",
  EMERGENCY_DISABLE: "EMERGENCY_DISABLE",
  IDENTITY_REVOKED: "IDENTITY_REVOKED",
} as const;
export type PhotoClearReason = (typeof PhotoClearReason)[keyof typeof PhotoClearReason];

/**
 * Canonical grant state machine (derived, not persisted - faceVerifiedAt is
 * the only stored bit). Transitions:
 *   NOT_GRANTED --(all conditions pass)--> ELIGIBLE --(grant)--> GRANTED
 *   GRANTED --(clear: any PhotoClearReason)--> CLEARED --> NOT_GRANTED
 *   NOT_GRANTED/ELIGIBLE --(UNDER_REVIEW)--> SUSPENDED
 *   any --(PROVIDER_DISABLED | EMERGENCY_DISABLED)--> BLOCKED
 * A GRANT may ONLY move NOT_GRANTED/ELIGIBLE -> GRANTED; nothing else grants.
 */
export const PhotoGrantState = {
  NOT_GRANTED: "NOT_GRANTED",
  ELIGIBLE: "ELIGIBLE",
  GRANTED: "GRANTED",
  CLEARED: "CLEARED",
  SUSPENDED: "SUSPENDED",
  BLOCKED: "BLOCKED",
} as const;
export type PhotoGrantState = (typeof PhotoGrantState)[keyof typeof PhotoGrantState];

export type GrantEvaluation = { eligible: boolean; reason: PhotoGrantReason };

const AUDIT = {
  granted: "photo_grant_granted",
  cleared: "photo_grant_cleared",
  refused: "photo_grant_refused",
} as const;

function refuse(reason: PhotoGrantReason): GrantEvaluation {
  return { eligible: false, reason };
}

/**
 * Evaluate whether the positive Photo Verified grant may be given. Read-only,
 * side-effect free. Returns a structured reason. Ordered from cheapest /
 * most-fundamental gate to most-specific so the first failing fact is
 * reported. In production the BINDING gate always fails (Epic 2 not built).
 */
export async function evaluatePhotoGrant(userId: string): Promise<GrantEvaluation> {
  // System gates first.
  if (!isFaceMatchConfigured()) return refuse(PhotoGrantReason.PROVIDER_DISABLED);
  if (faceEmergencyDisabled()) return refuse(PhotoGrantReason.EMERGENCY_DISABLED);

  const { circuitOpen } = await import("@/lib/services/provider-resilience");
  const { getFaceMatchProvider } = await import("@/lib/services/face-match-providers");
  if (await circuitOpen(`face_match:${getFaceMatchProvider().name}`)) {
    return refuse(PhotoGrantReason.PROVIDER_UNAVAILABLE);
  }

  // Identity precondition (the face layer only ever follows identity).
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { photoVerifiedAt: true },
  });
  if (!user?.photoVerifiedAt) return refuse(PhotoGrantReason.NOT_IDENTITY_VERIFIED);

  const job = await db.profilePhotoVerification.findUnique({
    where: { userId },
    select: {
      consentAt: true,
      consentVersion: true,
      referenceId: true,
      referenceStatus: true,
      status: true,
      badgeStatus: true,
    },
  });
  if (!job) return refuse(PhotoGrantReason.NO_FACE_REFERENCE);

  // Current biometric consent.
  if (!job.consentAt || job.consentVersion !== BIOMETRIC_CONSENT_VERSION) {
    return refuse(PhotoGrantReason.CONSENT_REQUIRED);
  }

  // A usable liveness-derived reference.
  const refUsable =
    job.referenceId && (job.referenceStatus === "ACTIVE" || job.referenceStatus === "EXPIRING");
  if (!refUsable) return refuse(PhotoGrantReason.NO_FACE_REFERENCE);

  // Identity<->liveness BINDING (C2). The current reference record must carry
  // a BOUND binding. Rotation mints a NEW reference record with no binding, so
  // it can never inherit an old grant. NOTHING produces BOUND yet (Epic 2), so
  // this is the gate that keeps the whole engine dormant in production.
  const activeRef = await db.faceReferenceRecord.findFirst({
    where: { userId, status: "LINKED" },
    orderBy: { referenceVersion: "desc" },
    select: { id: true },
  });
  const bound = activeRef
    ? await db.faceIdentityBinding.count({
        where: { faceReferenceId: activeRef.id, status: "BOUND" },
      })
    : 0;
  if (!bound) return refuse(PhotoGrantReason.NO_BINDING);

  // Current profile-integrity outcome (owned by the worker; we only READ it).
  if (job.status === "MANUAL_REVIEW") return refuse(PhotoGrantReason.UNDER_REVIEW);
  if (job.status !== "AUTO_VERIFIED" || job.badgeStatus !== "ACTIVE") {
    return refuse(PhotoGrantReason.NO_MATCH);
  }

  return { eligible: true, reason: PhotoGrantReason.ELIGIBLE };
}

/** Derive the canonical grant state for display/telemetry (never persisted). */
export function derivePhotoGrantState(
  user: { faceVerifiedAt?: Date | null },
  evaluation?: GrantEvaluation,
): PhotoGrantState {
  if (user.faceVerifiedAt) return PhotoGrantState.GRANTED;
  if (!evaluation) return PhotoGrantState.NOT_GRANTED;
  switch (evaluation.reason) {
    case PhotoGrantReason.PROVIDER_DISABLED:
    case PhotoGrantReason.EMERGENCY_DISABLED:
    case PhotoGrantReason.PROVIDER_UNAVAILABLE:
      return PhotoGrantState.BLOCKED;
    case PhotoGrantReason.UNDER_REVIEW:
      return PhotoGrantState.SUSPENDED;
    case PhotoGrantReason.ELIGIBLE:
      return PhotoGrantState.ELIGIBLE;
    default:
      return PhotoGrantState.NOT_GRANTED;
  }
}

/**
 * THE canonical grant. Evaluates eligibility and, only if ELIGIBLE, sets
 * faceVerifiedAt = now. Idempotent (a second call is a no-op) and
 * transaction-safe (the write is an atomic conditional update guarded on
 * faceVerifiedAt IS NULL, so concurrent grants never double-write and a
 * refusal never clears an existing grant). Never partially grants.
 */
export async function grantPhotoVerification(
  userId: string,
  opts: { actorId?: string | null } = {},
): Promise<{ granted: boolean; changed: boolean; reason: PhotoGrantReason }> {
  const evaluation = await evaluatePhotoGrant(userId);
  if (!evaluation.eligible) {
    await recordVerificationAudit({
      userId,
      eventType: AUDIT.refused,
      actorType: "system",
      actorId: opts.actorId ?? null,
      reasonCode: evaluation.reason,
    });
    return { granted: false, changed: false, reason: evaluation.reason };
  }

  // Atomic conditional grant: only sets when currently NULL.
  const res = await db.user.updateMany({
    where: { id: userId, faceVerifiedAt: null },
    data: { faceVerifiedAt: new Date() },
  });
  const changed = res.count > 0;
  if (changed) {
    await recordVerificationAudit({
      userId,
      eventType: AUDIT.granted,
      actorType: "system",
      actorId: opts.actorId ?? null,
      reasonCode: PhotoGrantReason.ELIGIBLE,
    });
  }
  return { granted: true, changed, reason: PhotoGrantReason.ELIGIBLE };
}

/**
 * THE canonical clear. Sets faceVerifiedAt = null (if set) with an audited
 * reason. Idempotent: a clear of an already-null grant is a silent no-op (no
 * audit). Because faceVerifiedAt is inert in production (never granted), every
 * clear is a 0-row no-op there - safe to wire into existing teardown paths.
 */
export async function clearPhotoVerification(
  userId: string,
  reason: PhotoClearReason,
  opts: { actorId?: string | null; actorType?: "system" | "admin" | "user" } = {},
): Promise<{ cleared: boolean }> {
  const res = await db.user.updateMany({
    where: { id: userId, faceVerifiedAt: { not: null } },
    data: { faceVerifiedAt: null },
  });
  const cleared = res.count > 0;
  if (cleared) {
    await recordVerificationAudit({
      userId,
      eventType: AUDIT.cleared,
      actorType: opts.actorType ?? "system",
      actorId: opts.actorId ?? null,
      reasonCode: reason,
    });
  }
  return { cleared };
}
