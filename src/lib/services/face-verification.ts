import { db } from "@/lib/db";
import { faceThresholds } from "@/lib/services/face-thresholds";
import {
  getFaceMatchProvider,
  isFaceMatchConfigured,
  faceMatchNotConfiguredProvider,
  FaceMatchNotConfiguredError,
  type FaceComparisonProvider,
  type FaceComparison,
} from "@/lib/services/face-match-providers";
import type {
  FaceBadgeStatus,
  FaceCheckClassification,
  FaceCheckDecision,
  ProfilePhotoVerificationStatus,
} from "@/generated/prisma/enums";

/**
 * Profile-photo verification - the SECOND layer of photo verification.
 *
 * Layer 1 (Stripe Identity, photo-verification.ts): document authenticity,
 * selfie liveness, selfie<->document match. Canonical verdict:
 * User.photoVerifiedAt. UNCHANGED by this module.
 *
 * Layer 2 (this module): does the Tirvea gallery belong to that verified
 * person? Cover policy (exactly one dominant matching face), gallery
 * policy (lifestyle photos allowed, unrelated-person photos flagged),
 * aggregate risk, badge suspension. PUBLIC BADGE =
 * photoVerifiedAt && User.faceBadgeSuspendedAt == null (isPubliclyVerified
 * in verification.ts).
 *
 * The whole layer is DORMANT until FACE_MATCH_PROVIDER is configured -
 * production behavior is bit-identical to the pre-face-check system
 * until the env is set (and can be rolled back the same way).
 *
 * Never runs inside a webhook request: enqueue is a row write; the run
 * happens via next/server after() or the /api/cron/face-checks sweep.
 */

// ---------------------------------------------------------------------------
// Policy - thresholds are PER-PROVIDER calibration knobs (env-tunable),
// not universal truths. Defaults are the mock provider's calibration.
// ---------------------------------------------------------------------------

export const BIOMETRIC_CONSENT_VERSION = "2026-07-bio-v1";

function num(env: string | undefined, fallback: number): number {
  const v = Number(env);
  return Number.isFinite(v) ? v : fallback;
}

export function faceMatchPolicy() {
  // Similarity/quality/manipulation cuts come from the ONE versioned
  // threshold source (face-thresholds.ts); defaults are unchanged. The
  // face-verification-specific knobs (cover dominance, gallery cap,
  // reference TTL) stay local.
  const t = faceThresholds();
  return {
    /** similarity >= this -> confident owner match */
    matchThreshold: t.matchThreshold,
    /** similarity <= this (with a face present) -> confident mismatch */
    mismatchThreshold: t.mismatchThreshold,
    /** best-face quality below this -> UNCERTAIN, never a verdict */
    minQuality: t.minQuality,
    /** manipulation risk >= this -> MANIPULATION_RISK */
    manipulationThreshold: t.manipulationRiskThreshold,
    /** cover dominant-face area ratio below this -> not a valid cover face */
    coverMinDominance: num(process.env.FACE_COVER_MIN_DOMINANCE, 0.2),
    /** gallery OTHER_PERSON_ONLY count that suspends the badge */
    maxOtherPersonPhotos: num(process.env.FACE_MAX_OTHER_PERSON_PHOTOS, 2),
    /** reference re-challenge horizon (days) */
    referenceTtlDays: num(process.env.FACE_REFERENCE_TTL_DAYS, 365),
  };
}

export type FaceMatchPolicy = ReturnType<typeof faceMatchPolicy>;

export type PhotoClassification = {
  classification: FaceCheckClassification;
  decision: FaceCheckDecision;
  failureReason: string | null;
  confidenceBand: "confident" | "uncertain" | "mismatch" | null;
};

/**
 * Pure classification of ONE comparison result under the policy.
 * Exported for tests - contains the entire per-photo decision table.
 */
export function classifyComparison(
  cmp: FaceComparison,
  manipulationRisk: number | null,
  opts: { isCover: boolean; policy?: FaceMatchPolicy },
): PhotoClassification {
  // Calibration passes a CANDIDATE policy to re-score captured comparisons
  // under trial thresholds without new AWS calls; production passes none.
  const p = opts.policy ?? faceMatchPolicy();

  if (manipulationRisk !== null && manipulationRisk >= p.manipulationThreshold) {
    return {
      classification: "MANIPULATION_RISK",
      decision: opts.isCover ? "REJECTED" : "FLAGGED",
      failureReason: "manipulation_suspected",
      confidenceBand: null,
    };
  }

  if (cmp.faceCount === 0) {
    // Lifestyle/pet/travel photos are fine in the gallery; a cover MUST
    // show the user.
    return opts.isCover
      ? {
          classification: "NO_FACE",
          decision: "REJECTED",
          failureReason: "cover_no_face",
          confidenceBand: null,
        }
      : {
          classification: "NO_FACE",
          decision: "ALLOWED",
          failureReason: null,
          confidenceBand: null,
        };
  }

  const quality = cmp.qualityScore ?? 1;
  const similarity = cmp.similarity ?? 0;
  const confident = similarity >= p.matchThreshold && quality >= p.minQuality;
  const mismatch = similarity <= p.mismatchThreshold && quality >= p.minQuality;

  if (opts.isCover) {
    const dominant = (cmp.dominantFaceRatio ?? 0) >= p.coverMinDominance;
    if (confident && cmp.ownerDetected && cmp.faceCount === 1 && dominant) {
      return {
        classification: "OWNER_MATCHED",
        decision: "PASSED",
        failureReason: null,
        confidenceBand: "confident",
      };
    }
    if (mismatch && !cmp.ownerDetected) {
      // Fail closed: a cover that confidently shows someone else.
      return {
        classification: "OTHER_PERSON_ONLY",
        decision: "REJECTED",
        failureReason: "cover_other_person",
        confidenceBand: "mismatch",
      };
    }
    // multiple faces / low quality / mid-band similarity -> human decides
    return {
      classification: cmp.faceCount > 1 ? "GROUP_PHOTO" : "UNCERTAIN",
      decision: "FLAGGED",
      failureReason: cmp.faceCount > 1 ? "cover_multiple_faces" : "cover_uncertain",
      confidenceBand: "uncertain",
    };
  }

  // Gallery photo
  if (cmp.ownerDetected && confident) {
    return cmp.faceCount > 1
      ? {
          classification: "GROUP_PHOTO",
          decision: "ALLOWED",
          failureReason: null,
          confidenceBand: "confident",
        }
      : {
          classification: "OWNER_MATCHED",
          decision: "PASSED",
          failureReason: null,
          confidenceBand: "confident",
        };
  }
  if (!cmp.ownerDetected && mismatch) {
    return {
      classification: "OTHER_PERSON_ONLY",
      decision: "FLAGGED",
      failureReason: "gallery_other_person",
      confidenceBand: "mismatch",
    };
  }
  return {
    classification: "UNCERTAIN",
    decision: "FLAGGED",
    failureReason: "gallery_uncertain",
    confidenceBand: "uncertain",
  };
}

// ---------------------------------------------------------------------------
// Audit trail - every transition writes an immutable event
// ---------------------------------------------------------------------------

export async function recordVerificationAudit(event: {
  userId: string;
  verificationId?: string | null;
  eventType: string;
  actorType: "system" | "admin" | "user";
  actorId?: string | null;
  previousStatus?: string | null;
  newStatus?: string | null;
  reasonCode?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.verificationAuditEvent
    .create({
      data: {
        userId: event.userId,
        verificationId: event.verificationId ?? null,
        eventType: event.eventType,
        actorType: event.actorType,
        actorId: event.actorId ?? null,
        previousStatus: event.previousStatus ?? null,
        newStatus: event.newStatus ?? null,
        reasonCode: event.reasonCode ?? null,
        metadata: (event.metadata ?? {}) as never,
      },
    })
    .catch(() => {
      // Audit writes must never break the flow they audit.
    });
}

// ---------------------------------------------------------------------------
// Enqueue (cheap, webhook-safe) + run (expensive, after()/cron only)
// ---------------------------------------------------------------------------

/**
 * Enqueue a profile-photo verification for a user whose IDENTITY was just
 * verified (or whose photos changed). Row write only - safe inside any
 * request. No-op while the face layer is unconfigured.
 */
export async function enqueueProfilePhotoVerification(
  userId: string,
  reason: string,
  opts: {
    identitySessionId?: string | null;
    consent?: boolean;
    country?: string | null;
    isRecovery?: boolean;
  } = {},
): Promise<boolean> {
  // C-3: EVERY entry point admits through the ONE canonical gate. New work
  // is refused when the cohort/country/percent/legal/emergency gates say
  // so; recovery of already-admitted work passes isRecovery.
  const { admitToFaceVerification, faceEnvironment } = await import("@/lib/services/face-rollout");
  const decision = await admitToFaceVerification(userId, {
    country: opts.country,
    isRecovery: opts.isRecovery,
    // Granting consent in THIS enqueue (first liveness) -> pass it so admit
    // doesn't chicken-and-egg on a row that hasn't been written yet.
    // Otherwise admit reads the stored consent on the job row.
    hasActiveConsent: opts.consent ? true : undefined,
  });
  if (!decision.admit) return false;
  const provider = getFaceMatchProvider();

  const existing = await db.profilePhotoVerification.findUnique({ where: { userId } });

  // C-2: a job with no VALID active reference must NOT run - it needs a
  // fresh Tirvea liveness capture. Set LIVENESS_REQUIRED (actionable UX),
  // never QUEUED, so the run path never calls an unsupported reference
  // mint. A valid ACTIVE/EXPIRING reference proceeds to QUEUED normally.
  const hasValidReference =
    Boolean(existing?.referenceId) &&
    (existing?.referenceStatus === "ACTIVE" || existing?.referenceStatus === "EXPIRING");
  const nextStatus = hasValidReference ? "QUEUED" : "LIVENESS_REQUIRED";

  const row = await db.profilePhotoVerification.upsert({
    where: { userId },
    create: {
      userId,
      provider: provider.name,
      status: nextStatus,
      badgeStatus: "REVIEWING",
      identitySessionId: opts.identitySessionId ?? null,
      consentVersion: opts.consent ? BIOMETRIC_CONSENT_VERSION : null,
      consentAt: opts.consent ? new Date() : null,
    },
    update: {
      status: nextStatus,
      badgeStatus: existing?.badgeStatus === "SUSPENDED" ? "SUSPENDED" : "REVIEWING",
      identitySessionId: opts.identitySessionId ?? existing?.identitySessionId ?? null,
      // release any stale lease when re-enqueuing
      leaseToken: null,
      leaseExpiresAt: null,
      ...(opts.consent ? { consentVersion: BIOMETRIC_CONSENT_VERSION, consentAt: new Date() } : {}),
    },
  });
  await recordVerificationAudit({
    userId,
    verificationId: row.id,
    eventType: "face_check_enqueued",
    actorType: "system",
    previousStatus: existing?.status ?? null,
    newStatus: nextStatus,
    reasonCode: reason,
  });
  void faceEnvironment;
  return true;
}

type FaceImageLoader = (storagePath: string | null) => Promise<Buffer | null>;
let faceImageLoaderOverride: FaceImageLoader | null = null;

/** Test seam: inject the photo-bytes loader (null restores storage). */
export function setFaceImageLoader(loader: FaceImageLoader | null): void {
  faceImageLoaderOverride = loader;
}

/** Card-size variant bytes for a photo (the canonical comparison input). */
async function loadPhotoBytes(storagePath: string | null): Promise<Buffer | null> {
  if (faceImageLoaderOverride) return faceImageLoaderOverride(storagePath);
  if (!storagePath) return null;
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data } = await admin.storage.from("photos").download(`${storagePath}/card.webp`);
  if (!data) return null;
  return Buffer.from(await data.arrayBuffer());
}

export type ProfileDecision = {
  status: ProfilePhotoVerificationStatus;
  badgeStatus: FaceBadgeStatus;
  riskLevel: number;
};

/**
 * Pure aggregate decision from per-photo outcomes. Exported for tests.
 *   AUTO_VERIFIED - cover passed, no high-risk gallery pattern
 *   MANUAL_REVIEW - cover flagged/uncertain OR mixed identity signals
 *   REJECTED      - cover confidently shows someone else / no valid face
 *   SUSPENDED     - aggregate OTHER_PERSON pattern beyond the policy cap
 */
export function decideProfile(
  checks: Array<{
    decision: FaceCheckDecision;
    classification: FaceCheckClassification;
    isCover: boolean;
  }>,
): ProfileDecision {
  const p = faceMatchPolicy();
  const cover = checks.find((c) => c.isCover);
  const gallery = checks.filter((c) => !c.isCover);
  const otherPersonCount = gallery.filter((c) => c.classification === "OTHER_PERSON_ONLY").length;
  const manipulationCount = checks.filter((c) => c.classification === "MANIPULATION_RISK").length;
  const riskLevel =
    otherPersonCount + manipulationCount * 2 + (cover?.decision === "REJECTED" ? 3 : 0);

  if (otherPersonCount > p.maxOtherPersonPhotos) {
    return { status: "SUSPENDED", badgeStatus: "SUSPENDED", riskLevel };
  }
  if (!cover || cover.decision === "REJECTED") {
    // No publishable cover face: profile cannot carry the badge, but a
    // benign cause (cover_no_face) is user-fixable -> action required.
    return { status: "REJECTED", badgeStatus: "SUSPENDED", riskLevel };
  }
  if (cover.decision === "FLAGGED" || checks.some((c) => c.decision === "FLAGGED")) {
    return { status: "MANUAL_REVIEW", badgeStatus: "REVIEWING", riskLevel };
  }
  return { status: "AUTO_VERIFIED", badgeStatus: "ACTIVE", riskLevel };
}

/**
 * Run (or re-run) the profile-photo verification for one user. Checks
 * ONLY photo versions without a valid stored result (immutable
 * photoVersion pin) - unchanged verified photos are never re-analysed.
 * Idempotent and crash-safe: rows are upserted per (photo, version).
 */
export async function runProfilePhotoVerification(
  userId: string,
  opts: { provider?: FaceComparisonProvider; leaseToken?: string } = {},
): Promise<ProfileDecision | null> {
  const provider = opts.provider ?? getFaceMatchProvider();
  if (provider === faceMatchNotConfiguredProvider) return null;

  // The threshold identity a cached PhotoFaceCheck is valid FOR: the
  // provider AND the active calibration (threshold) version. A stored
  // verdict is reused only when photoId + mediaVersion + THIS token match,
  // so a provider swap or a threshold recalibration re-runs every photo.
  const activeCalibration = `${provider.name}:${process.env.FACE_CALIBRATION_VERSION?.trim() || "v0"}`;

  const { randomUUID } = await import("node:crypto");
  const leaseMs = (Number(process.env.FACE_LEASE_MINUTES) || 15) * 60_000;
  // At-most-one active worker per job (H-2). A caller with a lease token
  // (the sweep) must already hold it; a direct caller (after()/liveness)
  // self-claims here: QUEUED|LIVENESS_REQUIRED-with-reference -> CLAIMED.
  if (opts.leaseToken) {
    const held = await db.profilePhotoVerification.count({
      where: { userId, status: "CLAIMED", leaseToken: opts.leaseToken },
    });
    if (held === 0) return null; // lease lost/expired - another worker owns it
  } else {
    const token = randomUUID();
    const claim = await db.profilePhotoVerification.updateMany({
      where: {
        userId,
        status: { in: ["QUEUED", "CLAIMED"] },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }],
      },
      data: {
        status: "CLAIMED",
        leaseToken: token,
        leaseExpiresAt: new Date(Date.now() + leaseMs),
        claimedBy: "direct",
      },
    });
    if (claim.count === 0) return null; // not claimable (already running / not queued)
    opts = { ...opts, leaseToken: token };
  }

  const job = await db.profilePhotoVerification.findUnique({ where: { userId } });
  if (!job) return null;

  // Identity verification is the precondition for the badge pipeline.
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { photoVerifiedAt: true },
  });
  if (!user?.photoVerifiedAt) return null;

  const previousStatus = job.status;
  await db.profilePhotoVerification.update({
    where: { id: job.id },
    data: { status: "CHECKING", lastRunAt: new Date() },
  });

  try {
    // Reference lifecycle guard (C-2): EXPIRED/REVOKED/DELETED/none means
    // the user needs a FRESH Tirvea liveness capture. We NEVER call a
    // generic provider.createReference here (the AWS adapter correctly
    // refuses it) and NEVER dead-letter this normal condition - we stop
    // safely at LIVENESS_REQUIRED and surface action-required UX. The
    // liveness flow (face-liveness.ts) enrolls the reference and re-queues.
    const referenceUsable =
      job.referenceId && (job.referenceStatus === "ACTIVE" || job.referenceStatus === "EXPIRING");
    if (!referenceUsable) {
      await db.profilePhotoVerification.update({
        where: { id: job.id },
        data: {
          status: "LIVENESS_REQUIRED",
          badgeStatus: job.badgeStatus === "ACTIVE" ? "REVIEWING" : job.badgeStatus,
        },
      });
      await recordVerificationAudit({
        userId,
        verificationId: job.id,
        eventType: "liveness_required",
        actorType: "system",
        previousStatus,
        newStatus: "LIVENESS_REQUIRED",
        reasonCode: "no_active_reference",
      });
      return null;
    }
    const referenceId = job.referenceId!;

    const photos = await db.photo.findMany({
      where: { userId, status: "ACTIVE" },
      orderBy: [{ isCover: "desc" }, { position: "asc" }],
      select: { id: true, mediaVersion: true, isCover: true, storagePath: true },
    });

    const results: Array<{
      decision: FaceCheckDecision;
      classification: FaceCheckClassification;
      isCover: boolean;
    }> = [];

    for (const photo of photos) {
      // Version pin: an existing result for THIS exact stored version is
      // reused; a replaced/recropped image (mediaVersion bump) is not. The
      // verdict is ALSO only reused when it was produced by the current
      // provider + threshold version (activeCalibration) - a recalibration
      // or provider swap re-analyses even an unchanged photo.
      const existing = await db.photoFaceCheck.findUnique({
        where: {
          photoId_photoVersion_verificationId: {
            photoId: photo.id,
            photoVersion: photo.mediaVersion,
            verificationId: job.id,
          },
        },
      });
      if (
        existing &&
        existing.decision !== "PENDING" &&
        existing.calibrationVersion === activeCalibration
      ) {
        results.push({
          decision: existing.decision,
          classification: existing.classification,
          isCover: photo.isCover,
        });
        continue;
      }

      const bytes = await loadPhotoBytes(photo.storagePath);
      if (!bytes) {
        // Unreadable bytes are never a verdict.
        await db.photoFaceCheck.upsert({
          where: {
            photoId_photoVersion_verificationId: {
              photoId: photo.id,
              photoVersion: photo.mediaVersion,
              verificationId: job.id,
            },
          },
          create: {
            verificationId: job.id,
            userId,
            photoId: photo.id,
            photoVersion: photo.mediaVersion,
            isCoverAtCheck: photo.isCover,
            calibrationVersion: activeCalibration,
            classification: "UNCERTAIN",
            decision: "FLAGGED",
            failureReason: "image_unreadable",
          },
          update: {
            calibrationVersion: activeCalibration,
            classification: "UNCERTAIN",
            decision: "FLAGGED",
            failureReason: "image_unreadable",
          },
        });
        results.push({ decision: "FLAGGED", classification: "UNCERTAIN", isCover: photo.isCover });
        continue;
      }

      const input = { image: bytes, photoId: photo.id, photoVersion: photo.mediaVersion };
      const { withResilience: resilient } = await import("@/lib/services/provider-resilience");
      const [cmp, manipulation] = await resilient(`face_match:${provider.name}`, () =>
        Promise.all([
          provider.compareReferenceToPhoto(referenceId, input),
          provider.assessManipulationRisk(input),
        ]),
      );
      const verdict = classifyComparison(cmp, manipulation.risk, { isCover: photo.isCover });

      await db.photoFaceCheck.upsert({
        where: {
          photoId_photoVersion_verificationId: {
            photoId: photo.id,
            photoVersion: photo.mediaVersion,
            verificationId: job.id,
          },
        },
        create: {
          verificationId: job.id,
          userId,
          photoId: photo.id,
          photoVersion: photo.mediaVersion,
          isCoverAtCheck: photo.isCover,
          calibrationVersion: activeCalibration,
          classification: verdict.classification,
          decision: verdict.decision,
          faceCount: cmp.faceCount,
          ownerDetected: cmp.ownerDetected,
          similarityScore: cmp.similarity,
          confidenceBand: verdict.confidenceBand,
          qualityScore: cmp.qualityScore,
          manipulationRisk: manipulation.risk,
          failureReason: verdict.failureReason,
        },
        update: {
          isCoverAtCheck: photo.isCover,
          calibrationVersion: activeCalibration,
          classification: verdict.classification,
          decision: verdict.decision,
          faceCount: cmp.faceCount,
          ownerDetected: cmp.ownerDetected,
          similarityScore: cmp.similarity,
          confidenceBand: verdict.confidenceBand,
          qualityScore: cmp.qualityScore,
          manipulationRisk: manipulation.risk,
          failureReason: verdict.failureReason,
          reviewedById: null,
          reviewedAt: null,
        },
      });
      results.push({
        decision: verdict.decision,
        classification: verdict.classification,
        isCover: photo.isCover,
      });
    }

    let decision = decideProfile(results);
    // Risk gate (threat-model Phase 2): a decision never rests on face
    // comparison alone. CRITICAL composite risk blocks auto-verification
    // and routes to a human - it never grants and never auto-rejects.
    const { computeVerificationRisk } = await import("@/lib/services/risk-engine");
    const risk = await computeVerificationRisk(userId).catch(() => null);
    if (decision.status === "AUTO_VERIFIED") {
      if (risk?.band === "CRITICAL") {
        decision = { ...decision, status: "MANUAL_REVIEW", badgeStatus: "REVIEWING" };
        await recordVerificationAudit({
          userId,
          verificationId: job.id,
          eventType: "risk_gate_hold",
          actorType: "system",
          newStatus: "MANUAL_REVIEW",
          reasonCode: "risk_critical",
        });
      }
    }
    await db.profilePhotoVerification.update({
      where: { id: job.id },
      data: {
        status: decision.status,
        badgeStatus: decision.badgeStatus,
        riskLevel: decision.riskLevel,
        lastValidatedAt: new Date(),
        riskBand: risk?.band ?? null,
        calibrationVersion: process.env.FACE_CALIBRATION_VERSION?.trim() || null,
        // release the lease (H-2)
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
    // Public badge suspension rides ONE denormalized column so hot read
    // paths (discovery/explore) never join the face tables.
    await db.user.update({
      where: { id: userId },
      data: {
        faceBadgeSuspendedAt: decision.badgeStatus === "SUSPENDED" ? new Date() : null,
      },
    });
    await recordVerificationAudit({
      userId,
      verificationId: job.id,
      eventType: "face_check_run",
      actorType: "system",
      previousStatus,
      newStatus: decision.status,
      reasonCode: decision.status === "AUTO_VERIFIED" ? null : "policy",
      metadata: { riskLevel: decision.riskLevel, photos: results.length },
    });

    if (decision.status === "AUTO_VERIFIED") {
      const { notifyUser } = await import("@/lib/services/notify");
      await notifyUser({
        userId,
        type: "PROFILE_VERIFIED",
        title: "Photo verification complete",
        body: "Your profile photos are confirmed - your badge is live.",
        dedupeKey: `face-check:${job.id}:v${job.referenceVersion}:auto`,
      });
      // Duplicate-likeness search rides successful verifications (Phase 4;
      // only LIKELY_IMPERSONATION may auto-suspend, inside runDuplicateCheck).
      const { runDuplicateCheck } = await import("@/lib/services/face-reference");
      await runDuplicateCheck(userId).catch(() => null);
    } else if (decision.status === "REJECTED" || decision.status === "SUSPENDED") {
      // Adverse outcomes are APPEALABLE: surface through the existing
      // violation/appeal machine (immutable AppealEvent timeline).
      const { createFaceViolation } = await import("@/lib/services/face-reference");
      await createFaceViolation(
        userId,
        "PHOTO_MISMATCH",
        decision.status === "REJECTED" ? "cover_not_confirmed" : "aggregate_mismatch_risk",
      ).catch(() => null);
    }
    return decision;
  } catch (error) {
    // Provider outage / timeout: park the job for the cron sweep; the
    // badge keeps its previous state (fail SAFE for verified users, fail
    // CLOSED for badge grants - nothing is granted on error).
    await db.profilePhotoVerification.update({
      where: { id: job.id },
      data: { status: "QUEUED" },
    });
    await recordVerificationAudit({
      userId,
      verificationId: job.id,
      eventType: "face_check_error",
      actorType: "system",
      previousStatus: "CHECKING",
      newStatus: "QUEUED",
      reasonCode:
        error instanceof FaceMatchNotConfiguredError ? "not_configured" : "provider_error",
    });
    return null;
  }
}

/**
 * Photo-change hook (upload / replace / cover change). Cheap: marks the
 * job QUEUED + badge REVIEWING; the actual analysis runs via after()/cron.
 * Never demands a new Stripe session - the stored reference is reused
 * until it expires or fraud policy requires a re-challenge.
 */
export async function onProfilePhotosChanged(userId: string, reason: string): Promise<void> {
  if (!isFaceMatchConfigured()) return;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { photoVerifiedAt: true, profile: { select: { country: true } } },
  });
  if (!user?.photoVerifiedAt) return; // face layer only follows identity
  // C-3: admission is enforced INSIDE enqueue via the canonical gate. An
  // already-existing job is recovery (already admitted); a new one admits
  // on cohort. Pass country so the one gate sees it.
  const existing = await db.profilePhotoVerification.findUnique({
    where: { userId },
    select: { id: true },
  });
  await enqueueProfilePhotoVerification(userId, reason, {
    country: user.profile?.country,
    isRecovery: Boolean(existing),
  });
}

/** GDPR deletion path - destroy provider-side biometric material. */
export async function deleteFaceVerificationData(userId: string): Promise<void> {
  // H-1/H-3: delete EVERY provider FaceId in the registry (not just the
  // active pointer), idempotently and audited, BEFORE dropping local rows.
  const { deleteAllUserReferences } = await import("@/lib/services/face-reference-registry");
  await deleteAllUserReferences(userId, "account_teardown").catch(() => undefined);

  const job = await db.profilePhotoVerification.findUnique({ where: { userId } });
  if (!job) return;
  if (job.referenceId) {
    try {
      await getFaceMatchProvider().deleteReference(job.referenceId);
    } catch {
      // Provider unreachable: the row deletion below still severs our
      // pointer; the retention cron retries orphan cleanup.
    }
  }
  await db.profilePhotoVerification.delete({ where: { id: job.id } }).catch(() => {});
  await recordVerificationAudit({
    userId,
    eventType: "face_data_deleted",
    actorType: "system",
    reasonCode: "account_teardown",
  });
}

/** Cron sweep: pick up QUEUED jobs (recovery for lost after() runs). */
export async function sweepQueuedFaceChecks(
  limit = Number(process.env.FACE_SWEEP_BATCH) || 10,
  opts: { timeBudgetMs?: number } = {},
): Promise<number> {
  if (!isFaceMatchConfigured()) return 0;
  const provider = getFaceMatchProvider();

  // Provider-aware: an OPEN circuit means every run would fail - skip the
  // whole sweep instead of hammering the vendor (jobs stay claimable).
  const { circuitOpen } = await import("@/lib/services/provider-resilience");
  if (await circuitOpen(`face_match:${provider.name}`)) return 0;

  const timeBudgetMs =
    opts.timeBudgetMs ?? (Number(process.env.FACE_SWEEP_TIME_BUDGET_MS) || 45_000);
  const leaseMs = (Number(process.env.FACE_LEASE_MINUTES) || 15) * 60_000;
  const started = Date.now();
  const leaseCutoff = new Date(started - leaseMs);

  // Candidates, OLDEST FIRST (fairness): fresh QUEUED work plus CHECKING
  // rows whose lease expired (crashed worker). Index-backed
  // (status, updatedAt) - never a full-table scan.
  const candidates = await db.profilePhotoVerification.findMany({
    where: {
      OR: [
        { status: "QUEUED" },
        { status: "CLAIMED", leaseExpiresAt: { lt: new Date() } },
        { status: "CHECKING", lastRunAt: { lt: leaseCutoff } },
      ],
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: { id: true, userId: true, status: true, lastRunAt: true },
  });

  let processed = 0;
  const { randomUUID } = await import("node:crypto");
  for (const row of candidates) {
    if (Date.now() - started > timeBudgetMs) break; // safe continuation next tick
    // EXCLUSIVE claim (H-2): transition to a DISTINCT CLAIMED state with a
    // lease token. Two concurrent claimers both target the observed state
    // in the WHERE; the row changes to CLAIMED so exactly ONE update
    // matches (count 1) - the loser gets count 0. Reclaim of a stale
    // CLAIMED/CHECKING row pins lastRunAt so only the expired lease loses.
    const leaseToken = randomUUID();
    const claim = await db.profilePhotoVerification.updateMany({
      where: {
        id: row.id,
        status: row.status,
        ...(row.status !== "QUEUED" ? { lastRunAt: row.lastRunAt } : {}),
      },
      data: {
        status: "CLAIMED",
        leaseToken,
        leaseExpiresAt: new Date(Date.now() + leaseMs),
        claimedBy: `sweep:${started}`,
        lastRunAt: new Date(),
        attemptCount: { increment: 1 },
      },
    });
    if (claim.count === 0) continue; // another worker won this row
    const result = await runProfilePhotoVerification(row.userId, { leaseToken });
    if (result) processed += 1;
  }
  return processed;
}

// ---------------------------------------------------------------------------
// Admin review actions - every action writes a VerificationAuditEvent
// ---------------------------------------------------------------------------

export type FaceAdminAction =
  | "approve"
  | "reject_photo"
  | "request_new_selfie"
  | "suspend_badge"
  | "restore_badge"
  | "escalate";

export async function adminFaceAction(opts: {
  actorId: string;
  verificationId: string;
  action: FaceAdminAction;
  /** Required for reject_photo. */
  photoCheckId?: string;
  reasonCode?: string;
}): Promise<{ status: ProfilePhotoVerificationStatus; badgeStatus: FaceBadgeStatus } | null> {
  const job = await db.profilePhotoVerification.findUnique({
    where: { id: opts.verificationId },
    select: { id: true, userId: true, status: true, badgeStatus: true, referenceId: true },
  });
  if (!job) return null;
  const audit = (eventType: string, newStatus: string, reasonCode?: string | null) =>
    recordVerificationAudit({
      userId: job.userId,
      verificationId: job.id,
      eventType,
      actorType: "admin",
      actorId: opts.actorId,
      previousStatus: job.status,
      newStatus,
      reasonCode: reasonCode ?? opts.reasonCode ?? null,
    });

  switch (opts.action) {
    case "approve": {
      await db.$transaction([
        db.photoFaceCheck.updateMany({
          where: { verificationId: job.id, decision: "FLAGGED" },
          data: { decision: "ALLOWED", reviewedById: opts.actorId, reviewedAt: new Date() },
        }),
        db.profilePhotoVerification.update({
          where: { id: job.id },
          data: { status: "AUTO_VERIFIED", badgeStatus: "ACTIVE", riskLevel: 0 },
        }),
        db.user.update({ where: { id: job.userId }, data: { faceBadgeSuspendedAt: null } }),
      ]);
      await audit("face_admin_approve", "AUTO_VERIFIED");
      return { status: "AUTO_VERIFIED", badgeStatus: "ACTIVE" };
    }
    case "reject_photo": {
      if (!opts.photoCheckId) return null;
      const check = await db.photoFaceCheck.findUnique({
        where: { id: opts.photoCheckId },
        select: { id: true, photoId: true, verificationId: true },
      });
      if (!check || check.verificationId !== job.id) return null;
      await db.$transaction([
        db.photoFaceCheck.update({
          where: { id: check.id },
          data: { decision: "REJECTED", reviewedById: opts.actorId, reviewedAt: new Date() },
        }),
        // Unpublish via the EXISTING moderation semantic - one gate for
        // "this photo may not be shown", not a second one.
        db.photo.update({
          where: { id: check.photoId },
          data: {
            status: "REJECTED",
            moderation: "REJECTED",
            moderatedById: opts.actorId,
            moderatedAt: new Date(),
          },
        }),
      ]);
      await audit("face_admin_reject_photo", job.status, "photo_rejected");
      // Photo set changed: re-run so cover fallback / aggregate risk update.
      await enqueueProfilePhotoVerification(job.userId, "admin_photo_rejected");
      return { status: "QUEUED", badgeStatus: job.badgeStatus };
    }
    case "request_new_selfie": {
      // Delete EVERY provider FaceId for the user (H-1 completeness), then
      // put the job into an ACTIONABLE LIVENESS_REQUIRED state (C-2/H-3) -
      // NOT a QUEUED row that would immediately fail a background run.
      const { deleteAllUserReferences } = await import("@/lib/services/face-reference-registry");
      await deleteAllUserReferences(job.userId, "admin_request_new_selfie").catch(() => undefined);
      const { invalidateOpenLivenessSessions } = await import("@/lib/services/face-liveness");
      await invalidateOpenLivenessSessions(job.userId).catch(() => undefined);
      await db.profilePhotoVerification.update({
        where: { id: job.id },
        data: {
          referenceId: null,
          referenceStatus: "REVOKED",
          rotationReason: "manual_review",
          status: "LIVENESS_REQUIRED",
          badgeStatus: "REVIEWING",
          expiresAt: new Date(),
        },
      });
      const { notifyUser } = await import("@/lib/services/notify");
      await notifyUser({
        userId: job.userId,
        type: "SYSTEM",
        title: "Please verify again",
        body: "We need a fresh verification selfie to keep your badge. It only takes a minute.",
        dedupeKey: `face-rechallenge:${job.id}:${Date.now()}`,
      });
      await audit("face_admin_request_selfie", "LIVENESS_REQUIRED", "re_challenge");
      return { status: "LIVENESS_REQUIRED", badgeStatus: "REVIEWING" };
    }
    case "suspend_badge": {
      await db.$transaction([
        db.profilePhotoVerification.update({
          where: { id: job.id },
          data: { status: "SUSPENDED", badgeStatus: "SUSPENDED" },
        }),
        db.user.update({ where: { id: job.userId }, data: { faceBadgeSuspendedAt: new Date() } }),
      ]);
      await audit("face_admin_suspend", "SUSPENDED");
      return { status: "SUSPENDED", badgeStatus: "SUSPENDED" };
    }
    case "restore_badge": {
      await db.$transaction([
        db.profilePhotoVerification.update({
          where: { id: job.id },
          data: { status: "AUTO_VERIFIED", badgeStatus: "ACTIVE" },
        }),
        db.user.update({ where: { id: job.userId }, data: { faceBadgeSuspendedAt: null } }),
      ]);
      await audit("face_admin_restore", "AUTO_VERIFIED");
      return { status: "AUTO_VERIFIED", badgeStatus: "ACTIVE" };
    }
    case "escalate": {
      await audit("face_admin_escalate", job.status, "fraud_review");
      return { status: job.status, badgeStatus: job.badgeStatus };
    }
  }
}
