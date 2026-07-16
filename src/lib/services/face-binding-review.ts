import { db } from "@/lib/db";
import {
  FaceBindingEngine,
  BINDING_STATUS,
  type FaceBindingStatus,
} from "@/lib/services/face-binding";
import {
  BOUND_REASONS,
  FAILED_REASONS,
  NEW_CAPTURE_REASONS,
} from "@/lib/services/human-review-binding";
import {
  grantPhotoVerification,
  clearPhotoVerification,
  PhotoClearReason,
} from "@/lib/services/photo-grant";
import {
  enqueueProfilePhotoVerification,
  runProfilePhotoVerification,
  recordVerificationAudit,
  BIOMETRIC_CONSENT_VERSION,
} from "@/lib/services/face-verification";
import { rotateReference } from "@/lib/services/face-reference";
import { faceEmergencyDisabled } from "@/lib/services/face-rollout";
import { notifyUser } from "@/lib/services/notify";

/**
 * Epic 3 - the human binding REVIEW decision service. The admin route is a
 * thin wrapper over this. It re-checks preconditions, drives the decision
 * EXCLUSIVELY through FaceBindingEngine.completeReview() (BOUND is never
 * written here directly), and NEVER sets faceVerifiedAt itself - a BOUND
 * decision only enqueues + runs the current profile check and then asks the
 * canonical grant service, which grants only on a current MATCH.
 *
 * Server-only.
 */

export type ReviewDecision = "BOUND" | "BINDING_FAILED" | "REQUEST_NEW_CAPTURE";

export type ReviewCode =
  | "OK"
  | "NOT_FOUND"
  | "NOT_REVIEWABLE"
  | "IDENTITY_NOT_VERIFIED"
  | "CONSENT_NOT_ACTIVE"
  | "STALE_REFERENCE"
  | "EMERGENCY_DISABLED"
  | "INVALID_REASON"
  | "CONFLICT";

export type ReviewResult = {
  ok: boolean;
  code: ReviewCode;
  status: FaceBindingStatus | null;
  /** Whether the positive Photo Verified grant was set (BOUND + current MATCH). */
  granted: boolean;
};

function reasonValidFor(decision: ReviewDecision, reasonCode: string): boolean {
  if (decision === "BOUND") return BOUND_REASONS.includes(reasonCode);
  if (decision === "BINDING_FAILED") return FAILED_REASONS.includes(reasonCode);
  return NEW_CAPTURE_REASONS.includes(reasonCode);
}

async function auditDecision(
  userId: string,
  bindingId: string,
  eventType: string,
  from: string,
  to: string,
  reviewerId: string,
  reasonCode: string,
  note?: string | null,
): Promise<void> {
  await recordVerificationAudit({
    userId,
    eventType,
    actorType: "admin",
    actorId: reviewerId, // server-derived
    previousStatus: from,
    newStatus: to,
    reasonCode,
    // Internal metadata only - no biometric data, no raw vendor payloads. A
    // short note is truncated; it is never surfaced publicly.
    metadata: { bindingId, note: note ? note.slice(0, 500) : null },
  });
}

async function notify(
  userId: string,
  bindingId: string,
  kind: string,
  title: string,
  body: string,
): Promise<void> {
  // Reuse the SYSTEM channel; canonical per-binding dedupe (no reason details).
  await notifyUser({
    userId,
    type: "SYSTEM",
    title,
    body,
    dedupeKey: `binding-review:${bindingId}:${kind}`,
  }).catch(() => undefined);
}

/**
 * Apply an authorized human binding decision. `reviewer.id` is SERVER-DERIVED
 * by the caller (never from the client). Idempotent + guarded against stale /
 * concurrent / withdrawn-consent / revoked-identity / rotated-reference cases.
 */
export async function submitBindingReview(input: {
  bindingId: string;
  decision: ReviewDecision;
  reasonCode: string;
  note?: string | null;
  reviewer: { id: string };
}): Promise<ReviewResult> {
  const { bindingId, decision, reasonCode, reviewer } = input;
  const note = input.note ?? null;

  // Emergency kill switch halts ALL completion/grant (Phase 14).
  if (faceEmergencyDisabled())
    return { ok: false, code: "EMERGENCY_DISABLED", status: null, granted: false };

  if (!reasonValidFor(decision, reasonCode)) {
    return { ok: false, code: "INVALID_REASON", status: null, granted: false };
  }

  const binding = await db.faceIdentityBinding.findUnique({ where: { id: bindingId } });
  if (!binding) return { ok: false, code: "NOT_FOUND", status: null, granted: false };

  // Only a case actually awaiting review is reviewable (handles double-submit).
  if (binding.status !== BINDING_STATUS.MANUAL_REVIEW) {
    return { ok: false, code: "NOT_REVIEWABLE", status: binding.status, granted: false };
  }

  const userId = binding.userId;
  const [user, job] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { photoVerifiedAt: true } }),
    db.profilePhotoVerification.findUnique({
      where: { userId },
      select: { consentAt: true, consentVersion: true, referenceId: true, referenceStatus: true },
    }),
  ]);

  const identityVerified = Boolean(user?.photoVerifiedAt);
  const consentActive =
    Boolean(job?.consentAt) && job?.consentVersion === BIOMETRIC_CONSENT_VERSION;

  // Stale-reference guard: the binding must target the CURRENT linked reference.
  const currentRef = await db.faceReferenceRecord.findFirst({
    where: { userId, status: "LINKED" },
    orderBy: { referenceVersion: "desc" },
    select: { id: true },
  });
  const referenceStale =
    binding.faceReferenceId != null && binding.faceReferenceId !== currentRef?.id;

  // ---- BOUND: strongest preconditions; never grants directly --------------
  if (decision === "BOUND") {
    if (!identityVerified)
      return { ok: false, code: "IDENTITY_NOT_VERIFIED", status: binding.status, granted: false };
    if (!consentActive)
      return { ok: false, code: "CONSENT_NOT_ACTIVE", status: binding.status, granted: false };
    if (referenceStale)
      return { ok: false, code: "STALE_REFERENCE", status: binding.status, granted: false };

    const done = await FaceBindingEngine.completeReview(bindingId, "BOUND", {
      id: reviewer.id,
      reasonCode,
    });
    if (done.code !== "OK" || done.status !== "BOUND") {
      return { ok: false, code: "CONFLICT", status: done.status, granted: false };
    }
    await auditDecision(
      userId,
      bindingId,
      "binding_bound",
      "MANUAL_REVIEW",
      "BOUND",
      reviewer.id,
      reasonCode,
      note,
    );

    // Binding proves identity<->face ONLY. Now prove the CURRENT cover matches
    // through the canonical worker; grant only if it MATCHES (grant re-checks).
    await enqueueProfilePhotoVerification(userId, "binding_bound", { isRecovery: true });
    await runProfilePhotoVerification(userId).catch(() => null);
    await recordVerificationAudit({
      userId,
      eventType: "profile_check_enqueued",
      actorType: "admin",
      actorId: reviewer.id,
      newStatus: "QUEUED",
      reasonCode: "post_binding",
    });
    const grant = await grantPhotoVerification(userId, { actorId: reviewer.id });

    await notify(
      userId,
      bindingId,
      "completed",
      "Checking your profile photos",
      "Your verification is confirmed. We're checking that your current photos match.",
    );
    return { ok: true, code: "OK", status: "BOUND", granted: grant.granted && grant.changed };
  }

  // ---- BINDING_FAILED: fail closed; clear any grant; account stays usable --
  if (decision === "BINDING_FAILED") {
    const done = await FaceBindingEngine.completeReview(bindingId, "BINDING_FAILED", {
      id: reviewer.id,
      reasonCode,
    });
    if (done.code !== "OK" || done.status !== "BINDING_FAILED") {
      return { ok: false, code: "CONFLICT", status: done.status, granted: false };
    }
    await clearPhotoVerification(userId, PhotoClearReason.BINDING_FAILED, {
      actorType: "admin",
      actorId: reviewer.id,
    });
    await auditDecision(
      userId,
      bindingId,
      "binding_failed",
      "MANUAL_REVIEW",
      "BINDING_FAILED",
      reviewer.id,
      reasonCode,
      note,
    );
    await notify(
      userId,
      bindingId,
      "failed",
      "We couldn't confirm the same person",
      "Take a new face check or request support. Your account is unaffected.",
    );
    return { ok: true, code: "OK", status: "BINDING_FAILED", granted: false };
  }

  // ---- REQUEST_NEW_CAPTURE: invalidate + require a fresh capture -----------
  await FaceBindingEngine.invalidateBinding(userId, "reference_rotated");
  // Rotation returns the user to LIVENESS_REQUIRED, invalidates open liveness
  // sessions, and clears any Photo Verified grant via the canonical clearer.
  await rotateReference(userId, "manual_review", { type: "admin", id: reviewer.id });
  await auditDecision(
    userId,
    bindingId,
    "binding_new_capture",
    "MANUAL_REVIEW",
    "NOT_BOUND",
    reviewer.id,
    reasonCode,
    note,
  );
  await notify(
    userId,
    bindingId,
    "new_capture",
    "Take a new face check",
    "We need a clearer capture to continue photo verification.",
  );
  return { ok: true, code: "OK", status: "NOT_BOUND", granted: false };
}
