import { db } from "@/lib/db";
import { computeVerificationRisk, type RiskBand } from "@/lib/services/risk-engine";
import { isPubliclyVerified, PUBLIC_BADGE_SELECT } from "@/lib/services/verification";

/**
 * Support-scoped verification view (Phase 15). The return type IS the
 * privacy contract: it structurally cannot carry face images, biometric
 * templates, vendor identifiers (referenceId, providerSessionId, file
 * ids) or raw similarity scores - support agents see states, dates,
 * reason codes and bands, nothing else. Tests pin the shape.
 */

export type VerificationSupportView = {
  identity: {
    status: "verified" | "pending" | "rejected" | "expired" | "not_started";
    verifiedAt: string | null;
  };
  badge: { visible: boolean; state: string };
  faceLayer: {
    status: string | null;
    referenceLifecycle: {
      status: string | null;
      version: number;
      createdAt: string | null;
      expiresAt: string | null;
      rotationReason: string | null;
    } | null;
    duplicateClassification: string;
  } | null;
  riskBand: RiskBand;
  timeline: Array<{
    at: string;
    event: string;
    from: string | null;
    to: string | null;
    reason: string | null;
  }>;
  appeals: Array<{ status: string; submittedAt: string; decidedAt: string | null }>;
  policyReasons: string[];
};

export async function getVerificationSupportView(
  userId: string,
): Promise<VerificationSupportView | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      // F-2 (L6.7.1): load the canonical badge fields so `badge.visible` is
      // resolved by the Trust Contract, never recomputed here.
      ...PUBLIC_BADGE_SELECT,
      verifications: {
        where: { type: "PHOTO" },
        select: { status: true },
        take: 1,
      },
    },
  });
  if (!user) return null;

  const [job, events, appeals, risk] = await Promise.all([
    db.profilePhotoVerification.findUnique({
      where: { userId },
      select: {
        status: true,
        badgeStatus: true,
        referenceStatus: true,
        referenceVersion: true,
        rotationReason: true,
        duplicateClass: true,
        createdAt: true,
        expiresAt: true,
        checks: {
          where: { failureReason: { not: null } },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { failureReason: true },
        },
      },
    }),
    db.verificationAuditEvent.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        createdAt: true,
        eventType: true,
        previousStatus: true,
        newStatus: true,
        reasonCode: true,
      },
    }),
    db.appeal.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { status: true, createdAt: true, reviewedAt: true },
    }),
    computeVerificationRisk(userId).catch(() => ({ band: "LOW" as RiskBand, signals: [] })),
  ]);

  const identityWorkflow = user.verifications[0]?.status ?? null;
  const identityStatus = user.photoVerifiedAt
    ? ("verified" as const)
    : identityWorkflow === "PENDING" || identityWorkflow === "IN_REVIEW"
      ? ("pending" as const)
      : identityWorkflow === "REJECTED"
        ? ("rejected" as const)
        : identityWorkflow === "EXPIRED"
          ? ("expired" as const)
          : ("not_started" as const);

  return {
    identity: {
      status: identityStatus,
      verifiedAt: user.photoVerifiedAt?.toISOString() ?? null,
    },
    badge: {
      // F-2 (L6.7.1): the admin badge is the PUBLIC badge - resolved by the
      // Trust Contract (identity + not-suspended + current gallery == verified),
      // so support sees exactly what members see. Never recomputed here.
      visible: isPubliclyVerified(user),
      state: user.faceBadgeSuspendedAt ? "suspended" : (job?.badgeStatus ?? "NONE").toLowerCase(),
    },
    faceLayer: job
      ? {
          status: job.status,
          referenceLifecycle: {
            status: job.referenceStatus,
            version: job.referenceVersion,
            createdAt: job.createdAt.toISOString(),
            expiresAt: job.expiresAt?.toISOString() ?? null,
            rotationReason: job.rotationReason,
          },
          duplicateClassification: job.duplicateClass,
        }
      : null,
    riskBand: risk.band,
    timeline: events.map((e) => ({
      at: e.createdAt.toISOString(),
      event: e.eventType,
      from: e.previousStatus,
      to: e.newStatus,
      reason: e.reasonCode,
    })),
    appeals: appeals.map((a) => ({
      status: a.status,
      submittedAt: a.createdAt.toISOString(),
      decidedAt: a.reviewedAt?.toISOString() ?? null,
    })),
    policyReasons: [
      ...new Set(job?.checks.map((c) => c.failureReason).filter(Boolean)),
    ] as string[],
  };
}
