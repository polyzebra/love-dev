import { db } from "@/lib/db";
import {
  faceRolloutConfig,
  faceInternalAllowlist,
  isFaceInternalUser,
  faceEnvironment,
  admitToFaceVerification,
} from "@/lib/services/face-rollout";
import { isExternalAlertChannelConfigured } from "@/lib/services/provider-resilience";
import {
  getFaceMatchProvider,
  faceMatchNotConfiguredProvider,
  evaluateProviderConfigAlerts,
} from "@/lib/services/face-match-providers";
import {
  enqueueProfilePhotoVerification,
  runProfilePhotoVerification,
  withdrawFaceConsent,
  adminFaceAction,
  setFaceImageLoader,
} from "@/lib/services/face-verification";
import { deleteAllUserReferences } from "@/lib/services/face-reference-registry";
import { isPubliclyVerified, PUBLIC_BADGE_SELECT } from "@/lib/services/verification";

/**
 * Phase 8 - internal rehearsal tooling. PREPARES a controlled internal
 * rehearsal; it never auto-enables production and never processes a real
 * biometric outside a fully-gated, human-authorized environment.
 *
 * Three surfaces build on this module:
 *   - scripts/face-rehearsal.ts (dry-run CLI: plan | simulate | cleanup)
 *   - GET /api/admin/face-rehearsal (admin-only gate/status view)
 *   - docs/FACE-REHEARSAL.md (checklist, cleanup, evidence template)
 *
 * NOTHING here prints a secret, a FaceId, a liveness sessionId, or any
 * other raw biometric identifier - only normalized status + counts.
 */

// ---------------------------------------------------------------- gates

export type RehearsalGate = {
  id: string;
  title: string;
  ok: boolean;
  /** Non-secret, human-readable status. Never contains a credential. */
  detail: string;
};

export type GateReport = { ready: boolean; gates: RehearsalGate[] };

/**
 * The counsel-approved legal-approval versions, recorded (not by code, by
 * whoever logs counsel sign-off) via FACE_LEGAL_APPROVED_VERSIONS. Empty by
 * default: with no recorded approval the rehearsal cannot run - production
 * stays honestly dormant. Supplying FACE_LEGAL_APPROVAL_VERSION alone is not
 * enough; it must MATCH a counsel-approved entry here.
 */
function counselApprovedLegalVersions(): string[] {
  return (process.env.FACE_LEGAL_APPROVED_VERSIONS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Evaluate the eight HARD GATES that must all pass before an internal
 * rehearsal may run. Read-only, no side effects, no delivery. Any false
 * `ok` means the rehearsal command must refuse.
 */
export function evaluateRehearsalGates(): GateReport {
  const cfg = faceRolloutConfig();
  const approved = counselApprovedLegalVersions();
  const supplied = process.env.FACE_LEGAL_APPROVAL_VERSION?.trim() || "";
  const allowlistSize = faceInternalAllowlist().size;
  const thresholdVersion =
    process.env.FACE_CALIBRATION_VERSION?.trim() ||
    process.env.FACE_THRESHOLD_VERSION?.trim() ||
    "";

  const gates: RehearsalGate[] = [
    {
      id: "legal_version_recorded",
      title: "Counsel-approved legal version exists",
      ok: approved.length > 0,
      detail: approved.length
        ? `${approved.length} counsel-approved version(s) recorded`
        : "no counsel-approved version recorded (set FACE_LEGAL_APPROVED_VERSIONS)",
    },
    {
      id: "legal_version_supplied",
      title: "FACE_LEGAL_APPROVAL_VERSION supplied by an authorized human",
      ok: supplied.length > 0 && approved.includes(supplied),
      detail: !supplied
        ? "not supplied"
        : approved.includes(supplied)
          ? "supplied and matches a counsel-approved version"
          : "supplied value is NOT among the counsel-approved versions",
    },
    {
      id: "aws_dpa_confirmed",
      title: "AWS DPA confirmed",
      ok: process.env.FACE_AWS_DPA_CONFIRMED === "1",
      detail:
        process.env.FACE_AWS_DPA_CONFIRMED === "1"
          ? "attested (FACE_AWS_DPA_CONFIRMED=1)"
          : "not attested (set FACE_AWS_DPA_CONFIRMED=1 once the DPA is executed)",
    },
    {
      id: "calibration_approved",
      title: "Calibration report approved",
      ok: process.env.FACE_CALIBRATION_APPROVED === "1" && Boolean(thresholdVersion),
      detail:
        process.env.FACE_CALIBRATION_APPROVED === "1" && thresholdVersion
          ? `approved (threshold version ${thresholdVersion})`
          : "not approved (approve a calibration report, set FACE_CALIBRATION_APPROVED=1 + a threshold version)",
    },
    {
      id: "alert_channel_active",
      title: "External alert channel active",
      ok: isExternalAlertChannelConfigured(),
      detail: isExternalAlertChannelConfigured()
        ? "configured"
        : "no external channel (set ALERT_WEBHOOK_URL)",
    },
    {
      id: "verification_percent_zero",
      title: "FACE_VERIFICATION_PERCENT = 0",
      ok: cfg.percent === 0,
      detail:
        cfg.percent === 0
          ? "0 (rehearsal admits via the internal allowlist only)"
          : `${cfg.percent} - must be 0 for a rehearsal (no percentage cohort)`,
    },
    {
      id: "internal_allowlist_configured",
      title: "Internal allowlist configured",
      ok: allowlistSize > 0,
      detail: allowlistSize
        ? `${allowlistSize} internal subject(s) on the allowlist`
        : "empty (set FACE_INTERNAL_USER_ALLOWLIST)",
    },
    {
      id: "emergency_disable_tested",
      title: "Emergency disable tested",
      ok: process.env.FACE_EMERGENCY_DISABLE_TESTED === "1",
      detail:
        process.env.FACE_EMERGENCY_DISABLE_TESTED === "1"
          ? "attested (FACE_EMERGENCY_DISABLE_TESTED=1)"
          : "not attested (verify the kill switch, then set FACE_EMERGENCY_DISABLE_TESTED=1)",
    },
  ];

  return { ready: gates.every((g) => g.ok), gates };
}

export class RehearsalNotReadyError extends Error {
  constructor(public readonly failed: RehearsalGate[]) {
    super(`Rehearsal gates not satisfied: ${failed.map((g) => g.id).join(", ")}`);
    this.name = "RehearsalNotReadyError";
  }
}

// ------------------------------------------------------------- the plan

export type RehearsalStep = { step: number; id: string; title: string };

/** The required internal-only journey (Phase 8), in order. */
export const REHEARSAL_JOURNEY: RehearsalStep[] = [
  { step: 1, id: "approved_internal_account", title: "Approved internal account" },
  { step: 2, id: "explicit_consent", title: "Explicit consent" },
  { step: 3, id: "identity_verified", title: "Stripe identity verified" },
  { step: 4, id: "reference_enrolled", title: "AWS reference enrolled" },
  { step: 5, id: "same_person_cover", title: "Same-person cover checked" },
  { step: 6, id: "badge_visible", title: "Badge visible" },
  { step: 7, id: "replacement_cover", title: "Different consenting internal subject as cover" },
  { step: 8, id: "badge_suspended", title: "Badge suspended" },
  { step: 9, id: "same_person_restored", title: "Same-person cover restored" },
  { step: 10, id: "badge_restored_by_policy", title: "Badge restored only through correct policy" },
  { step: 11, id: "consent_withdrawn", title: "Consent withdrawn" },
  { step: 12, id: "reference_deleted", title: "Reference deleted" },
  { step: 13, id: "emergency_disable", title: "Emergency disable tested" },
  { step: 14, id: "no_biometric_exposed", title: "No raw biometric identifiers exposed" },
];

// --------------------------------------------------------- journey run

export type StepResult = {
  step: number;
  id: string;
  title: string;
  status: "PASS" | "FAIL" | "SKIP";
  note: string;
};

export type RehearsalRun = {
  mode: "simulate";
  environment: string;
  provider: string;
  steps: StepResult[];
  ok: boolean;
  /** True iff no raw biometric identifier appeared anywhere in this run. */
  biometricSafe: boolean;
};

/** Substrings that must NEVER appear in rehearsal output (raw biometric ids). */
const BIOMETRIC_LEAK = /externalFaceId|FaceId|faceId|sessionId|referenceId|arn:aws|rekognition-/i;

function assertBiometricSafe(steps: StepResult[]): boolean {
  return !steps.some((s) => BIOMETRIC_LEAK.test(s.note));
}

/**
 * Execute the 14-step journey HEADLESSLY against the mock provider - the
 * safe "simulate" dry-run that proves the tooling + every policy transition
 * without touching a real biometric. Refuses in production and refuses any
 * provider other than mock (a real AWS rehearsal is operator-driven per the
 * checklist; this path is the automated self-test).
 *
 * Both subjects MUST already be on the internal allowlist and MUST have an
 * ACTIVE cover photo. The caller owns their lifecycle; cleanupRehearsal
 * restores them afterwards.
 */
export async function simulateRehearsalJourney(opts: {
  subjectId: string;
  coverSubjectId: string;
  actorId: string;
}): Promise<RehearsalRun> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("simulateRehearsalJourney refuses to run in production");
  }
  const provider = getFaceMatchProvider();
  if (provider === faceMatchNotConfiguredProvider || provider.name !== "mock") {
    throw new Error(
      "simulateRehearsalJourney requires the mock provider (FACE_MATCH_PROVIDER=mock)",
    );
  }

  const steps: StepResult[] = [];
  const record = (s: RehearsalStep, status: StepResult["status"], note: string): StepResult => {
    const r = { step: s.step, id: s.id, title: s.title, status, note };
    steps.push(r);
    return r;
  };
  const byId = (id: string) => REHEARSAL_JOURNEY.find((s) => s.id === id)!;
  const { subjectId, coverSubjectId, actorId } = opts;

  // Same-person by default; flipped to an impostor for the replacement step.
  let coverIsOwner = true;
  setFaceImageLoader(async () => Buffer.from(coverIsOwner ? "face:owner" : "face:other"));

  try {
    // 1 - approved internal account (both subjects on the allowlist)
    if (isFaceInternalUser(subjectId) && isFaceInternalUser(coverSubjectId)) {
      record(
        byId("approved_internal_account"),
        "PASS",
        "both subjects are on the internal allowlist",
      );
    } else {
      record(
        byId("approved_internal_account"),
        "FAIL",
        "a subject is not on the internal allowlist",
      );
      return finish(steps);
    }

    // 2 - explicit consent
    await enqueueProfilePhotoVerification(subjectId, "rehearsal_consent", { consent: true });
    const consented = await db.profilePhotoVerification.findUnique({
      where: { userId: subjectId },
      select: { consentAt: true },
    });
    record(
      byId("explicit_consent"),
      consented?.consentAt ? "PASS" : "FAIL",
      consented?.consentAt ? "biometric consent recorded" : "consent not recorded",
    );

    // 3 - Stripe identity verified (rehearsal stands in for the provider verdict)
    await db.user.update({ where: { id: subjectId }, data: { photoVerifiedAt: new Date() } });
    record(byId("identity_verified"), "PASS", "identity verified (photoVerifiedAt set)");

    // 4 - AWS reference enrolled (real liveness->saga path; mock provider)
    const enrolled = await enrollForRehearsal(subjectId);
    record(
      byId("reference_enrolled"),
      enrolled ? "PASS" : "FAIL",
      enrolled ? "reference enrolled and linked (ACTIVE)" : "reference not enrolled",
    );

    // 5 - same-person cover checked
    coverIsOwner = true;
    const dec5 = await runProfilePhotoVerification(subjectId);
    const passed5 = dec5?.status === "AUTO_VERIFIED";
    record(
      byId("same_person_cover"),
      passed5 ? "PASS" : "FAIL",
      passed5
        ? "same-person cover auto-verified"
        : `unexpected decision: ${dec5?.status ?? "none"}`,
    );

    // 6 - badge visible
    const visible6 = await badgeVisible(subjectId);
    record(
      byId("badge_visible"),
      visible6 ? "PASS" : "FAIL",
      visible6 ? "verified badge is publicly visible" : "badge not visible",
    );

    // 7 - different consenting internal subject used as replacement cover.
    // A cover swap presents NEW bytes: bump the media version (invalidates
    // the cached verdict) and re-enqueue so the pipeline re-compares.
    coverIsOwner = false; // the cover now shows a DIFFERENT (consenting) subject
    const coverPhoto = await db.photo.findFirst({
      where: { userId: subjectId, isCover: true, status: "ACTIVE" },
      select: { id: true },
    });
    if (coverPhoto) {
      const { bumpPhotoMediaVersion } = await import("@/lib/services/photos");
      await bumpPhotoMediaVersion(coverPhoto.id);
    }
    await enqueueProfilePhotoVerification(subjectId, "rehearsal_recheck", { consent: true });
    const dec7 = await runProfilePhotoVerification(subjectId);
    const adverse7 =
      dec7?.status === "SUSPENDED" ||
      dec7?.status === "REJECTED" ||
      dec7?.status === "MANUAL_REVIEW";
    record(
      byId("replacement_cover"),
      adverse7 ? "PASS" : "FAIL",
      adverse7
        ? `impostor cover produced an adverse outcome (${dec7?.status})`
        : "impostor cover was not caught",
    );

    // 8 - badge suspended (auto if policy suspended; else the admin policy path)
    if (!(await badgeVisible(subjectId))) {
      record(byId("badge_suspended"), "PASS", "badge auto-suspended by policy");
    } else {
      const job = await jobFor(subjectId);
      await adminFaceAction({
        actorId,
        verificationId: job.id,
        action: "suspend_badge",
        reasonCode: "rehearsal_impostor",
      });
      const suspended = !(await badgeVisible(subjectId));
      record(
        byId("badge_suspended"),
        suspended ? "PASS" : "FAIL",
        suspended ? "badge suspended via policy action" : "badge still visible after suspend",
      );
    }

    // 9 - same-person cover restored (physical correction; badge stays suspended)
    coverIsOwner = true;
    const stillSuspended = !(await badgeVisible(subjectId));
    record(
      byId("same_person_restored"),
      stillSuspended ? "PASS" : "FAIL",
      stillSuspended
        ? "same-person cover restored; badge remains suspended (no silent auto-restore)"
        : "badge restored WITHOUT the policy path - unexpected",
    );

    // 10 - badge restored ONLY through the correct policy path
    const job10 = await jobFor(subjectId);
    await adminFaceAction({
      actorId,
      verificationId: job10.id,
      action: "restore_badge",
      reasonCode: "rehearsal_restore",
    });
    const restored = await badgeVisible(subjectId);
    record(
      byId("badge_restored_by_policy"),
      restored ? "PASS" : "FAIL",
      restored ? "badge restored through the admin restore_badge policy" : "badge not restored",
    );

    // 11 - consent withdrawn (badge hidden, identity intact)
    const w = await withdrawFaceConsent(subjectId);
    const afterWithdraw = await db.user.findUnique({
      where: { id: subjectId },
      select: { photoVerifiedAt: true, faceBadgeSuspendedAt: true },
    });
    const consentRow = await db.profilePhotoVerification.findUnique({
      where: { userId: subjectId },
      select: { consentAt: true },
    });
    const withdrawnOk =
      w.withdrawn &&
      !consentRow?.consentAt &&
      afterWithdraw?.photoVerifiedAt != null &&
      afterWithdraw?.faceBadgeSuspendedAt != null;
    record(
      byId("consent_withdrawn"),
      withdrawnOk ? "PASS" : "FAIL",
      withdrawnOk
        ? "consent withdrawn; badge hidden; identity (photoVerifiedAt) intact"
        : "withdrawal state incorrect",
    );

    // 12 - reference deleted (idempotent; no FaceId surfaced)
    const del = await deleteAllUserReferences(subjectId, "rehearsal_cleanup");
    const activeRefs = await db.faceReferenceRecord.count({
      where: { userId: subjectId, status: { in: ["PROVIDER_CREATED", "LINKED"] } },
    });
    record(
      byId("reference_deleted"),
      del.failed === 0 && activeRefs === 0 ? "PASS" : "FAIL",
      `references deleted (failed: ${del.failed}); active references remaining: ${activeRefs}`,
    );

    // 13 - emergency disable tested (kill switch blocks admission + alerts)
    const savedKill = process.env.FACE_EMERGENCY_DISABLE;
    process.env.FACE_EMERGENCY_DISABLE = "1";
    let killOk = false;
    try {
      const admit = await admitToFaceVerification(coverSubjectId, { hasActiveConsent: true });
      const alerts = await evaluateProviderConfigAlerts();
      killOk =
        admit.admit === false &&
        admit.reason === "emergency_disable" &&
        alerts.fire.some((a) => a.kind === "emergency_disable_active");
    } finally {
      if (savedKill === undefined) delete process.env.FACE_EMERGENCY_DISABLE;
      else process.env.FACE_EMERGENCY_DISABLE = savedKill;
    }
    record(
      byId("emergency_disable"),
      killOk ? "PASS" : "FAIL",
      killOk
        ? "kill switch blocks admission and raises emergency_disable_active"
        : "kill switch did not block/alert",
    );

    // 14 - no raw biometric identifiers exposed
    const safe = assertBiometricSafe(steps);
    record(
      byId("no_biometric_exposed"),
      safe ? "PASS" : "FAIL",
      safe
        ? "all step output is free of raw biometric identifiers"
        : "a raw biometric identifier leaked into step output",
    );

    return finish(steps);
  } finally {
    setFaceImageLoader(null);
  }
}

function finish(steps: StepResult[]): RehearsalRun {
  return {
    mode: "simulate",
    environment: faceEnvironment(),
    provider: getFaceMatchProvider().name,
    steps,
    ok: steps.every((s) => s.status !== "FAIL"),
    biometricSafe: assertBiometricSafe(steps),
  };
}

async function badgeVisible(userId: string): Promise<boolean> {
  const u = await db.user.findUnique({
    where: { id: userId },
    select: PUBLIC_BADGE_SELECT,
  });
  return u ? isPubliclyVerified(u) : false;
}

async function jobFor(userId: string): Promise<{ id: string }> {
  const job = await db.profilePhotoVerification.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!job) throw new Error("no verification job for subject");
  return job;
}

/** Drive the real liveness->saga enrollment (mock provider) for a subject. */
async function enrollForRehearsal(userId: string): Promise<boolean> {
  const { createBoundLivenessSession, consumeLivenessFlow } =
    await import("@/lib/services/face-liveness");
  const created = await createBoundLivenessSession(userId);
  if ("error" in created) return false;
  const r = await consumeLivenessFlow(created.flowId, userId);
  if (r.state !== "checking_profile_photos") return false;
  const job = await db.profilePhotoVerification.findUnique({
    where: { userId },
    select: { referenceStatus: true },
  });
  return job?.referenceStatus === "ACTIVE";
}

// ------------------------------------------------------------- cleanup

export type CleanupResult = {
  subjects: Array<{ userId: string; referencesDeleted: number; referencesFailed: number }>;
};

/**
 * Restore internal rehearsal subjects to a clean pre-rehearsal state:
 * withdraw consent, delete every reference, clear the badge + identity flag
 * the rehearsal set, and drop the verification job + open liveness sessions.
 * Idempotent - safe to run repeatedly, safe to run after a partial rehearsal.
 */
export async function cleanupRehearsal(opts: { subjectIds: string[] }): Promise<CleanupResult> {
  const subjects: CleanupResult["subjects"] = [];
  for (const userId of opts.subjectIds) {
    await withdrawFaceConsent(userId).catch(() => ({ withdrawn: false }));
    const del = await deleteAllUserReferences(userId, "rehearsal_cleanup").catch(() => ({
      deleted: 0,
      failed: 0,
    }));
    await db.user
      .update({
        where: { id: userId },
        data: { faceBadgeSuspendedAt: null, photoVerifiedAt: null },
      })
      .catch(() => {});
    await db.livenessSession.deleteMany({ where: { userId } }).catch(() => {});
    await db.profilePhotoVerification.deleteMany({ where: { userId } }).catch(() => {});
    subjects.push({ userId, referencesDeleted: del.deleted, referencesFailed: del.failed });
  }
  return { subjects };
}
