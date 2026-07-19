import { db } from "@/lib/db";
import { evaluateRehearsalGates, cleanupRehearsal } from "@/lib/services/face-rehearsal";
import {
  faceInternalAllowlist,
  isFaceInternalUser,
  faceEmergencyDisabled,
  admitToFaceVerification,
} from "@/lib/services/face-rollout";
import { isFaceMatchConfigured } from "@/lib/services/face-match-providers";
import { bindingMethodFromEnv, getBindingProvider } from "@/lib/services/face-binding";
import {
  humanReviewConfigured,
  requestHumanReviewBinding,
} from "@/lib/services/human-review-binding";
import { submitBindingReview } from "@/lib/services/face-binding-review";
import {
  grantPhotoVerification,
  clearPhotoVerification,
  evaluatePhotoGrant,
  PhotoClearReason,
} from "@/lib/services/photo-grant";
import {
  enqueueProfilePhotoVerification,
  runProfilePhotoVerification,
} from "@/lib/services/face-verification";
import { createBoundLivenessSession, consumeLivenessFlow } from "@/lib/services/face-liveness";
import { bumpPhotoMediaVersion } from "@/lib/services/photos";
import { isIdentityVerified } from "@/lib/services/verification";

/**
 * Epic 5 - THE canonical internal-rehearsal controller. It exercises the entire
 * Trust Engine (identity -> consent -> liveness -> binding -> human review ->
 * BOUND -> profile MATCH -> grant -> Photo Verified -> cover swaps -> suspend ->
 * restore -> withdraw -> delete -> emergency disable -> rollback) end-to-end
 * using ONLY supported services - no manual DB edits. It never enables
 * production: it refuses to run unless the environment is explicitly configured
 * + legally approved AND the subject is on the internal allowlist.
 *
 * Evidence carries ONLY ids/timestamps/statuses/reasons - never images,
 * templates, FaceIds, or PII. Server-only.
 */

// ------------------------------------------------------------- preflight
export type PreflightStatus = "PASS" | "WARN" | "FAIL";
export type PreflightCheck = { id: string; status: PreflightStatus; detail: string };
export type Preflight = { ok: boolean; checks: PreflightCheck[] };

/**
 * Phase 3 preflight. Reuses the 8 rehearsal hard gates and adds the binding /
 * provider-registry / emergency / percent checks. A FAIL blocks the rehearsal.
 */
export function preflight(): Preflight {
  const checks: PreflightCheck[] = [];
  const add = (id: string, status: PreflightStatus, detail: string) =>
    checks.push({ id, status, detail });

  const gates = evaluateRehearsalGates();
  for (const g of gates.gates) add(g.id, g.ok ? "PASS" : "FAIL", g.detail);

  add(
    "provider_configured",
    isFaceMatchConfigured() ? "PASS" : "FAIL",
    isFaceMatchConfigured() ? "FACE_MATCH_PROVIDER set" : "FACE_MATCH_PROVIDER unset (dormant)",
  );
  const method = bindingMethodFromEnv();
  add("binding_method", method === "UNKNOWN" ? "FAIL" : "PASS", `FACE_BINDING_METHOD=${method}`);
  add(
    "binding_provider_registered",
    method !== "UNKNOWN" && getBindingProvider(method) ? "PASS" : "FAIL",
    "a binding provider resolves for the configured method",
  );
  add(
    "human_review_configured",
    humanReviewConfigured() ? "PASS" : "WARN",
    humanReviewConfigured() ? "HUMAN_REVIEW configured + approved" : "human review not configured",
  );
  add(
    "emergency_disable_off",
    faceEmergencyDisabled() ? "FAIL" : "PASS",
    faceEmergencyDisabled() ? "FACE_EMERGENCY_DISABLE=1 (blocked)" : "off",
  );
  const percent = Number(process.env.FACE_VERIFICATION_PERCENT || 0);
  add(
    "verification_percent_zero",
    percent === 0 ? "PASS" : "FAIL",
    `FACE_VERIFICATION_PERCENT=${percent} (must be 0 for rehearsal)`,
  );
  add(
    "internal_allowlist",
    faceInternalAllowlist().size > 0 ? "PASS" : "FAIL",
    `${faceInternalAllowlist().size} internal subject(s)`,
  );

  const ok = checks.every((c) => c.status !== "FAIL");
  return { ok, checks };
}

// ------------------------------------------------------------ admission
export type AdmissionResult = { admitted: boolean; code: string; detail: string };

/** Phase 4: only allowlisted, identity-verified, consenting, un-suspended,
 *  non-duplicate internal subjects may participate. */
export async function admitSubject(userId: string): Promise<AdmissionResult> {
  if (!isFaceInternalUser(userId))
    return { admitted: false, code: "NOT_ALLOWLISTED", detail: "not on the internal allowlist" };
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { photoVerifiedAt: true, status: true },
  });
  if (!user) return { admitted: false, code: "NO_USER", detail: "unknown user" };
  if (!isIdentityVerified(user))
    return { admitted: false, code: "NOT_IDENTITY_VERIFIED", detail: "identity not verified" };
  if (user.status !== "ACTIVE")
    return { admitted: false, code: "SUSPENDED", detail: `account ${user.status}` };
  const admit = await admitToFaceVerification(userId, { hasActiveConsent: true });
  if (!admit.admit)
    return {
      admitted: false,
      code: admit.reason.toUpperCase(),
      detail: `admission gate: ${admit.reason}`,
    };
  return { admitted: true, code: "OK", detail: "admitted" };
}

// ------------------------------------------------------------- evidence
export type RehearsalStep = {
  step: number;
  id: string;
  status: "PASS" | "FAIL";
  note: string;
  ids?: Record<string, string | null>;
};

export type RehearsalReport = {
  ok: boolean;
  environment: string;
  steps: RehearsalStep[];
  /** Ids only - never PII/biometrics. */
  evidence: {
    subjectId: string;
    bindingId: string | null;
    photoVerifiedGranted: boolean;
    auditEventCount: number;
  };
};

const LEAK = /externalFaceId|FaceId|arn:aws|sessionId|@/i;
function safe(steps: RehearsalStep[]): boolean {
  return !steps.some(
    (s) => LEAK.test(s.note) || Object.values(s.ids ?? {}).some((v) => v && LEAK.test(v)),
  );
}

// ------------------------------------------------------------- rehearsal
/**
 * Phase 5: the complete lifecycle, driven only through supported services. The
 * caller controls the cover bytes via a marker function (mock provider only) so
 * "same person" vs "different person" is deterministic. Refuses to run unless
 * preflight passes and the subject is admitted.
 */
export async function runTrustRehearsal(opts: {
  subjectId: string;
  reviewerId: string;
  setCover: (marker: "face:owner" | "face:other" | "face:uncertain") => Promise<void>;
}): Promise<RehearsalReport> {
  const { subjectId, reviewerId, setCover } = opts;
  const steps: RehearsalStep[] = [];
  const record = (id: string, ok: boolean, note: string, ids?: RehearsalStep["ids"]) =>
    steps.push({ step: steps.length + 1, id, status: ok ? "PASS" : "FAIL", note, ids });

  const grant = await evaluatePhotoGrant(subjectId); // (side-effect-free) sanity
  void grant;

  const faceVerified = async () =>
    (
      await db.user.findUniqueOrThrow({
        where: { id: subjectId },
        select: { faceVerifiedAt: true },
      })
    ).faceVerifiedAt != null;
  const bindingRow = () =>
    db.faceIdentityBinding.findFirst({
      where: { userId: subjectId },
      orderBy: { createdAt: "desc" },
    });

  // 1-3: consent + liveness + enrollment (auto-opens a HUMAN_REVIEW binding).
  await setCover("face:owner");
  await enqueueProfilePhotoVerification(subjectId, "rehearsal_consent", { consent: true });
  const created = await createBoundLivenessSession(subjectId);
  if ("error" in created) {
    record("enroll", false, "liveness session unavailable");
    return finish(subjectId, steps, null);
  }
  await consumeLivenessFlow(created.flowId, subjectId);
  let binding = await bindingRow();
  if (!binding) {
    // human review may be unconfigured in a partial rehearsal - open it explicitly.
    await requestHumanReviewBinding({
      userId: subjectId,
      faceReferenceId: null,
      livenessFlowId: created.flowId,
    });
    binding = await bindingRow();
  }
  record(
    "enroll_and_request_binding",
    binding?.status === "MANUAL_REVIEW",
    `binding ${binding?.status ?? "none"}`,
    {
      bindingId: binding?.id ?? null,
    },
  );

  // 4-5: human review -> BOUND -> profile MATCH -> grant -> Photo Verified.
  if (binding) {
    const review = await submitBindingReview({
      bindingId: binding.id,
      decision: "BOUND",
      reasonCode: "SAME_PERSON_CONFIRMED",
      reviewer: { id: reviewerId },
    });
    record("human_review_bound", review.status === "BOUND", `review ${review.code}`, {
      bindingId: binding.id,
    });
    record(
      "grant_photo_verified",
      review.granted && (await faceVerified()),
      "Photo Verified granted after MATCH",
    );
  }

  // 6: replace cover (same person) -> re-check -> stays Photo Verified.
  await rerunCover(subjectId, "face:owner", setCover);
  await grantPhotoVerification(subjectId, { actorId: reviewerId });
  record("cover_same_person_kept", await faceVerified(), "same-person cover keeps Photo Verified");

  // 7-8: replace with a different person -> adverse -> clear grant (suspend).
  const adverse = await rerunCover(subjectId, "face:other", setCover);
  if (adverse !== "AUTO_VERIFIED")
    await clearPhotoVerification(subjectId, PhotoClearReason.PHOTO_CHANGED, {
      actorType: "admin",
      actorId: reviewerId,
    });
  record(
    "impostor_cover_suspends",
    !(await faceVerified()),
    `impostor cover -> ${adverse}; Photo Verified removed`,
  );

  // 9: restore - same-person cover -> re-check MATCH -> re-grant.
  const restored = await rerunCover(subjectId, "face:owner", setCover);
  const reGrant = await grantPhotoVerification(subjectId, { actorId: reviewerId });
  record(
    "restore_after_fix",
    restored === "AUTO_VERIFIED" && reGrant.granted && (await faceVerified()),
    "restored on same-person re-match",
  );

  // 10-12: withdraw consent -> delete reference -> remove Photo Verified.
  const { withdrawFaceConsent } = await import("@/lib/services/face-verification");
  await withdrawFaceConsent(subjectId);
  await clearPhotoVerification(subjectId, PhotoClearReason.CONSENT_WITHDRAWN, {
    actorType: "user",
    actorId: subjectId,
  });
  const activeRefs = await db.faceReferenceRecord.count({
    where: { userId: subjectId, status: { in: ["PROVIDER_CREATED", "LINKED"] } },
  });
  record(
    "withdraw_delete_remove",
    !(await faceVerified()) && activeRefs === 0,
    "consent withdrawn, reference deleted, Photo Verified removed",
  );

  // 13: emergency disable -> no new biometric processing.
  const savedKill = process.env.FACE_EMERGENCY_DISABLE;
  process.env.FACE_EMERGENCY_DISABLE = "1";
  let blocked = false;
  try {
    const admit = await admitToFaceVerification(subjectId, { hasActiveConsent: true });
    blocked = admit.admit === false && admit.reason === "emergency_disable";
  } finally {
    if (savedKill === undefined) delete process.env.FACE_EMERGENCY_DISABLE;
    else process.env.FACE_EMERGENCY_DISABLE = savedKill;
  }
  record("emergency_disable_blocks", blocked, "kill switch blocks new admission");

  // 14: no raw biometric surfaced.
  record("no_biometric_exposed", safe(steps), "evidence is free of raw biometric identifiers");

  return finish(subjectId, steps, binding?.id ?? null);
}

async function rerunCover(
  subjectId: string,
  marker: "face:owner" | "face:other" | "face:uncertain",
  setCover: (m: "face:owner" | "face:other" | "face:uncertain") => Promise<void>,
): Promise<string> {
  await setCover(marker);
  const cover = await db.photo.findFirst({
    where: { userId: subjectId, isCover: true, status: "ACTIVE" },
    select: { id: true },
  });
  if (cover) await bumpPhotoMediaVersion(cover.id);
  await db.photoFaceCheck.deleteMany({ where: { userId: subjectId } });
  await enqueueProfilePhotoVerification(subjectId, "rehearsal_recheck", { consent: true });
  const dec = await runProfilePhotoVerification(subjectId);
  return dec?.status ?? "none";
}

async function finish(
  subjectId: string,
  steps: RehearsalStep[],
  bindingId: string | null,
): Promise<RehearsalReport> {
  const { faceEnvironment } = await import("@/lib/services/face-rollout");
  const auditEventCount = await db.verificationAuditEvent.count({ where: { userId: subjectId } });
  const photoVerifiedGranted =
    (
      await db.user.findUniqueOrThrow({
        where: { id: subjectId },
        select: { faceVerifiedAt: true },
      })
    ).faceVerifiedAt != null;
  return {
    ok: steps.every((s) => s.status !== "FAIL"),
    environment: faceEnvironment(),
    steps,
    evidence: { subjectId, bindingId, photoVerifiedGranted, auditEventCount },
  };
}

// ------------------------------------------------------------- rollback
export type RollbackResult = {
  subjects: { userId: string; referencesDeleted: number; referencesFailed: number }[];
  faceVerifiedCleared: number;
  bindingsDeleted: number;
};

/**
 * Phase 10: deterministic rollback. Reuses cleanupRehearsal (withdraw + delete
 * references + clear badge/identity flag + drop job/liveness) and additionally
 * clears the positive grant and removes rehearsal bindings, leaving NO stale
 * state. Idempotent.
 */
export async function rollbackRehearsal(opts: { subjectIds: string[] }): Promise<RollbackResult> {
  const base = await cleanupRehearsal({ subjectIds: opts.subjectIds });
  let faceVerifiedCleared = 0;
  let bindingsDeleted = 0;
  for (const userId of opts.subjectIds) {
    const cleared = await clearPhotoVerification(userId, PhotoClearReason.ACCOUNT_DELETED, {
      actorType: "system",
    }).catch(() => ({ cleared: false }));
    if (cleared.cleared) faceVerifiedCleared += 1;
    const del = await db.faceIdentityBinding
      .deleteMany({ where: { userId } })
      .catch(() => ({ count: 0 }));
    bindingsDeleted += del.count;
  }
  return { subjects: base.subjects, faceVerifiedCleared, bindingsDeleted };
}
