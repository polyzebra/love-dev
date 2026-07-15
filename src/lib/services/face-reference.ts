import { db } from "@/lib/db";
import { getFaceMatchProvider, isFaceMatchConfigured } from "@/lib/services/face-match-providers";
import {
  enqueueProfilePhotoVerification,
  recordVerificationAudit,
} from "@/lib/services/face-verification";
import type { DuplicateIdentityClass } from "@/generated/prisma/enums";

/**
 * Face reference LIFECYCLE + duplicate identity classification + the
 * appeal bridge (threat-model Phases 3-6).
 *
 * Lifecycle invariant: a reference is usable ONLY while ACTIVE or
 * EXPIRING. EXPIRED / REVOKED / DELETED references are NEVER reused -
 * face-verification.ts enforces this before every run; rotation is the
 * only way back (destroy at vendor -> ROTATING -> fresh enrolment).
 *
 * No parallel machinery: rotation reuses the existing job row +
 * enqueue/run pipeline; appeals reuse the EXISTING AccountViolation ->
 * Appeal -> reverseViolation machine (violationType PHOTO_MISMATCH /
 * IMPERSONATION already existed); every transition writes a
 * VerificationAuditEvent.
 */

export type RotationReason =
  | "provider_upgrade"
  | "reference_expiry"
  | "manual_review"
  | "fraud_investigation"
  | "user_request"
  | "policy_change";

/** Days before expiresAt at which a reference becomes EXPIRING. */
export function referenceRenewalWindowDays(): number {
  const v = Number(process.env.FACE_REFERENCE_RENEWAL_WINDOW_DAYS);
  return Number.isFinite(v) ? v : 30;
}

/**
 * Rotate the user's reference: destroy at the vendor, mark ROTATING and
 * re-enter the queue. Never touches identity verification - a rotation
 * NEVER demands a new Stripe session (identity re-verification is a
 * separate, explicit staff decision).
 */
export async function rotateReference(
  userId: string,
  reason: RotationReason,
  actor: { type: "system" | "admin" | "user"; id?: string | null } = { type: "system" },
): Promise<boolean> {
  const job = await db.profilePhotoVerification.findUnique({
    where: { userId },
    select: { id: true, referenceId: true, referenceStatus: true, status: true },
  });
  if (!job) return false;

  if (job.referenceId) {
    try {
      await getFaceMatchProvider().deleteReference(job.referenceId);
    } catch {
      // Vendor unreachable: severing our pointer still blocks reuse; the
      // reference is unreachable without the id we are about to drop.
    }
  }
  await db.profilePhotoVerification.update({
    where: { id: job.id },
    data: {
      referenceId: null,
      referenceStatus: "ROTATING",
      rotationReason: reason,
      // C-2: rotation ALWAYS returns the user to LIVENESS_REQUIRED - a
      // fresh Tirvea liveness capture mints the new reference. It never
      // requires a new Stripe Identity session (identity is unchanged).
      status: "LIVENESS_REQUIRED",
      ...(reason === "fraud_investigation" ? { badgeStatus: "SUSPENDED" as const } : {}),
    },
  });
  // Any open liveness session for the OLD reference is now void.
  const { invalidateOpenLivenessSessions } = await import("@/lib/services/face-liveness");
  await invalidateOpenLivenessSessions(userId).catch(() => undefined);
  await recordVerificationAudit({
    userId,
    verificationId: job.id,
    eventType: "face_reference_rotated",
    actorType: actor.type,
    actorId: actor.id ?? null,
    previousStatus: job.referenceStatus ?? "none",
    newStatus: "ROTATING",
    reasonCode: reason,
  });
  return true;
}

/**
 * Cron lane: advance lifecycle states + rotate what must rotate.
 *  - ACTIVE within the renewal window -> EXPIRING (badge untouched)
 *  - EXPIRING/ACTIVE past expiresAt   -> rotate(reference_expiry)
 *  - provider model drift             -> rotate(provider_upgrade)
 */
export async function sweepReferenceLifecycle(limit = 25): Promise<{
  markedExpiring: number;
  rotatedExpired: number;
  rotatedUpgraded: number;
}> {
  if (!isFaceMatchConfigured()) return { markedExpiring: 0, rotatedExpired: 0, rotatedUpgraded: 0 };
  const provider = getFaceMatchProvider();
  const now = new Date();
  const windowMs = referenceRenewalWindowDays() * 24 * 3600 * 1000;

  const markedExpiring = (
    await db.profilePhotoVerification.updateMany({
      where: {
        referenceStatus: "ACTIVE",
        expiresAt: { lte: new Date(now.getTime() + windowMs), gt: now },
      },
      data: { referenceStatus: "EXPIRING" },
    })
  ).count;

  const expired = await db.profilePhotoVerification.findMany({
    where: { referenceStatus: { in: ["ACTIVE", "EXPIRING"] }, expiresAt: { lte: now } },
    select: { userId: true },
    take: limit,
  });
  let rotatedExpired = 0;
  for (const row of expired) {
    if (await rotateReference(row.userId, "reference_expiry")) rotatedExpired += 1;
  }

  // Provider upgrade: references built with an older model rotate too.
  let rotatedUpgraded = 0;
  if (provider.modelVersion) {
    const stale = await db.profilePhotoVerification.findMany({
      where: {
        referenceStatus: { in: ["ACTIVE", "EXPIRING"] },
        provider: provider.name,
        providerModelVersion: { not: provider.modelVersion },
      },
      select: { userId: true },
      take: limit,
    });
    for (const row of stale) {
      if (await rotateReference(row.userId, "provider_upgrade")) rotatedUpgraded += 1;
    }
  }
  return { markedExpiring, rotatedExpired, rotatedUpgraded };
}

// ---------------------------------------------------------------------------
// Duplicate identity classification (Phase 4)
// ---------------------------------------------------------------------------

export type DuplicateMatchEvidence = {
  band: "confident" | "uncertain";
  /** The matched account, resolved from the matched referenceId. */
  other: {
    /** Other account was verified BEFORE this user (first-comer wins). */
    verifiedFirst: boolean;
    /** Other account currently banned/suspended for impersonation-class
     *  violations. */
    flaggedForImpersonation: boolean;
    /** Same declared birth date (+-1 day) - the twin-evidence signal. */
    birthDateMatches: boolean;
  } | null;
};

/**
 * Pure classification of ONE likeness match (exported for tests).
 * Deliberately conservative: only LIKELY_IMPERSONATION may drive an
 * automatic suspension; everything else is a human question.
 */
export function classifyDuplicateMatch(evidence: DuplicateMatchEvidence): DuplicateIdentityClass {
  if (!evidence.other) return "UNKNOWN";
  if (evidence.band === "uncertain") {
    // Mid-band similarity: relatives are the common benign explanation.
    return "FAMILY_RESEMBLANCE";
  }
  // Confident likeness:
  if (evidence.other.verifiedFirst || evidence.other.flaggedForImpersonation) {
    return "LIKELY_IMPERSONATION";
  }
  // Confident same-face, this user was first. Matching declared birth
  // dates are the evidence-based twin signal (PRR TD-4: TWIN_RISK is now
  // emitted, not dead); both routes are HUMAN questions, never automated.
  // Phase 29 note: SELF_RESTORE was REMOVED from automatic classification
  // (teardown anonymises the fields it keyed on); genuine restores surface
  // as LIKELY_DUPLICATE and resolve via manual review/appeal. The enum
  // value remains (Postgres enum removal is destructive) for historical
  // rows only.
  return evidence.other.birthDateMatches ? "TWIN_RISK" : "LIKELY_DUPLICATE";
}

/** Worst-outcome ordering for aggregating multiple matches. */
const DUPLICATE_SEVERITY: DuplicateIdentityClass[] = [
  "UNKNOWN",
  "LOW_CONFIDENCE",
  "SELF_RESTORE",
  "FAMILY_RESEMBLANCE",
  "TWIN_RISK",
  "LIKELY_DUPLICATE",
  "LIKELY_IMPERSONATION",
];
export function worstDuplicateClass(classes: DuplicateIdentityClass[]): DuplicateIdentityClass {
  let worst: DuplicateIdentityClass = classes.length ? "LOW_CONFIDENCE" : "UNKNOWN";
  for (const c of classes) {
    if (DUPLICATE_SEVERITY.indexOf(c) > DUPLICATE_SEVERITY.indexOf(worst)) worst = c;
  }
  return worst;
}

/**
 * Run the duplicate-likeness search for a user with an ACTIVE reference.
 * Stores the classification; ONLY LIKELY_IMPERSONATION suspends the
 * badge automatically (plus a violation so the user can appeal) - every
 * other non-benign outcome routes to manual review.
 */
export async function runDuplicateCheck(userId: string): Promise<DuplicateIdentityClass | null> {
  // Independently gated (Phase 32): likeness search has its own
  // calibration + legal approval track.
  const { faceRolloutConfig } = await import("@/lib/services/face-rollout");
  if (!faceRolloutConfig().duplicateSearchEnabled) return null;
  const provider = getFaceMatchProvider();
  if (!provider.searchLikeness) return null;
  const job = await db.profilePhotoVerification.findUnique({
    where: { userId },
    select: { id: true, referenceId: true, referenceStatus: true, status: true },
  });
  if (!job?.referenceId || !["ACTIVE", "EXPIRING"].includes(job.referenceStatus ?? "")) return null;

  const matches = await provider.searchLikeness(job.referenceId).catch(() => null);
  if (matches === null) return null;

  const me = await db.user.findUnique({
    where: { id: userId },
    select: { photoVerifiedAt: true, profile: { select: { birthDate: true } } },
  });

  const classes: DuplicateIdentityClass[] = [];
  for (const match of matches) {
    const otherJob = await db.profilePhotoVerification.findFirst({
      where: { referenceId: match.referenceId, userId: { not: userId } },
      select: {
        userId: true,
        user: {
          select: {
            photoVerifiedAt: true,
            status: true,
            profile: { select: { birthDate: true } },
            violations: {
              where: { violationType: "IMPERSONATION", reversedAt: null },
              select: { id: true },
              take: 1,
            },
          },
        },
      },
    });
    classes.push(
      classifyDuplicateMatch({
        band: match.band,
        other: otherJob
          ? {
              verifiedFirst: Boolean(
                otherJob.user.photoVerifiedAt &&
                me?.photoVerifiedAt &&
                otherJob.user.photoVerifiedAt < me.photoVerifiedAt,
              ),
              flaggedForImpersonation:
                otherJob.user.status === "BANNED" || otherJob.user.violations.length > 0,
              birthDateMatches: Boolean(
                me?.profile?.birthDate &&
                otherJob.user.profile?.birthDate &&
                Math.abs(
                  otherJob.user.profile.birthDate.getTime() - me.profile.birthDate.getTime(),
                ) <=
                  24 * 3600 * 1000,
              ),
            }
          : null,
      }),
    );
  }
  const verdict = worstDuplicateClass(classes);

  await db.profilePhotoVerification.update({
    where: { id: job.id },
    data: {
      duplicateClass: verdict,
      duplicateCheckedAt: new Date(),
      // Human routing for non-benign, non-impersonation outcomes.
      ...(["LIKELY_DUPLICATE", "TWIN_RISK"].includes(verdict) && job.status === "AUTO_VERIFIED"
        ? { status: "MANUAL_REVIEW" as const }
        : {}),
    },
  });
  await recordVerificationAudit({
    userId,
    verificationId: job.id,
    eventType: "duplicate_check",
    actorType: "system",
    newStatus: verdict,
    reasonCode: verdict === "UNKNOWN" ? "no_matches" : "likeness_matches",
    metadata: { matches: matches.length },
  });

  if (verdict === "LIKELY_IMPERSONATION") {
    const { faceRolloutConfig: cfg } = await import("@/lib/services/face-rollout");
    if (cfg().autoSuspendEnabled) {
      await suspendForImpersonation(userId, job.id);
    } else {
      // Auto-suspension not yet approved: HUMANS decide, badge untouched.
      await db.profilePhotoVerification.update({
        where: { id: job.id },
        data: { status: "MANUAL_REVIEW" },
      });
      await recordVerificationAudit({
        userId,
        verificationId: job.id,
        eventType: "duplicate_review_hold",
        actorType: "system",
        newStatus: "MANUAL_REVIEW",
        reasonCode: "auto_suspend_disabled",
      });
    }
  }
  return verdict;
}

/** The ONLY automatic suspension path from duplicate detection. */
async function suspendForImpersonation(userId: string, verificationId: string): Promise<void> {
  await db.$transaction([
    db.profilePhotoVerification.update({
      where: { id: verificationId },
      data: { status: "SUSPENDED", badgeStatus: "SUSPENDED" },
    }),
    db.user.update({ where: { id: userId }, data: { faceBadgeSuspendedAt: new Date() } }),
  ]);
  await createFaceViolation(userId, "IMPERSONATION", "duplicate_impersonation");
  await recordVerificationAudit({
    userId,
    verificationId,
    eventType: "face_auto_suspend",
    actorType: "system",
    newStatus: "SUSPENDED",
    reasonCode: "duplicate_impersonation",
  });
}

// ---------------------------------------------------------------------------
// Appeals bridge (Phase 5) - the EXISTING violation/appeal machine
// ---------------------------------------------------------------------------

/**
 * Adverse face outcomes become an appealable AccountViolation
 * (PHOTO_MISMATCH for cover/gallery verdicts, IMPERSONATION for
 * duplicates). The whole existing appeal workflow then applies:
 * submit -> review -> optional needs-info -> decision, every step an
 * immutable AppealEvent; approval calls reverseViolation, which loops
 * back into onFaceViolationReversed below. Dedupe: one open violation
 * per user+type.
 */
export async function createFaceViolation(
  userId: string,
  violationType: "PHOTO_MISMATCH" | "IMPERSONATION",
  reasonCode: string,
): Promise<string | null> {
  const existing = await db.accountViolation.findFirst({
    where: { userId, violationType, reversedAt: null },
    select: { id: true },
  });
  if (existing) return existing.id;
  const violation = await db.accountViolation.create({
    data: {
      userId,
      violationType,
      actionTaken: "WARNING", // badge withheld; account otherwise unrestricted
      description: `Photo verification: ${reasonCode}`,
      userVisibleReason:
        violationType === "IMPERSONATION"
          ? "Your verified badge is on hold while we review a potential identity conflict."
          : "Your verified badge is on hold because your profile photos could not be confirmed as you.",
      internalReason: reasonCode,
      appealAllowed: true,
      // Signal ownership (risk registry): the risk engine scores the face
      // outcome directly; trust-engine must not score this violation too.
      source: "face_verification",
    },
  });
  await recordVerificationAudit({
    userId,
    eventType: "face_violation_created",
    actorType: "system",
    newStatus: violationType,
    reasonCode,
    metadata: { violationId: violation.id },
  });
  return violation.id;
}

/**
 * Called by the appeal machine after reverseViolation on a face-class
 * violation: restore the badge and (optional new face check) rotate the
 * reference so the decision rests on fresh evidence - never on the data
 * that produced the contested outcome.
 */
export async function onFaceViolationReversed(
  userId: string,
  violationType: string,
  actorId: string | null,
): Promise<void> {
  if (violationType !== "PHOTO_MISMATCH" && violationType !== "IMPERSONATION") return;
  const job = await db.profilePhotoVerification.findUnique({
    where: { userId },
    select: { id: true, status: true },
  });
  if (!job) return;
  await db.$transaction([
    db.profilePhotoVerification.update({
      where: { id: job.id },
      data: { status: "AUTO_VERIFIED", badgeStatus: "ACTIVE", duplicateClass: "UNKNOWN" },
    }),
    db.user.update({ where: { id: userId }, data: { faceBadgeSuspendedAt: null } }),
  ]);
  await recordVerificationAudit({
    userId,
    verificationId: job.id,
    eventType: "face_appeal_reversed",
    actorType: "admin",
    actorId,
    previousStatus: job.status,
    newStatus: "AUTO_VERIFIED",
    reasonCode: "appeal_approved",
  });
  // Optional fresh evidence: re-check the CURRENT gallery (cheap - the
  // stored per-version verdicts of unchanged photos are reused; a staff
  // "request new selfie" is the stronger, explicit re-challenge).
  await enqueueProfilePhotoVerification(userId, "appeal_approved", { isRecovery: true });
}
