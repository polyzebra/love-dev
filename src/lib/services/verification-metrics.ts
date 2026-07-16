import { db } from "@/lib/db";
import { providerHealthState, type ProviderHealthState } from "@/lib/services/provider-resilience";
import { bandFromScore, type RiskBand } from "@/lib/services/risk-engine";

/**
 * Verification observability + fraud analytics (Phases 12 + 14).
 *
 * Every number here is an ANONYMOUS AGGREGATE computed from canonical
 * tables - no user ids, no biometric values, no vendor identifiers
 * appear in any payload. The four documented dashboards (Operations,
 * Security, Trust & Safety, Support - see the runbook) are groupings of
 * these metrics, all served by the one admin endpoint.
 *
 * False positive/negative proxies (labels do not exist without ground
 * truth): FP% = adverse automatic outcomes later overturned (approved
 * appeals / adverse outcomes); FN% = badges later suspended by staff or
 * duplicate-impersonation findings (post-grant suspensions / grants).
 */

export type VerificationMetrics = {
  windowDays: number;
  identity: {
    started: number;
    approved: number;
    rejected: number;
    expired: number;
    successRate: number | null;
    /** Median-ish duration: avg(statusChangedAt - createdAt) seconds of approvals. */
    avgApprovalSeconds: number | null;
  };
  face: {
    runs: number;
    autoVerified: number;
    manualReview: number;
    rejected: number;
    suspended: number;
    manualReviewRate: number | null;
    queueDepth: number;
    oldestQueuedMinutes: number | null;
    referenceRotations: number;
    deadLettered: number;
  };
  duplicates: Record<string, number>;
  appeals: { submitted: number; approved: number; rejected: number; appealRate: number | null };
  quality: { falsePositiveRate: number | null; falseNegativeRate: number | null };
  risk: Record<RiskBand, number>;
  providers: Record<string, ProviderHealthState>;
  /** Country distribution of users with adverse face outcomes (counts only). */
  adverseByCountry: Record<string, number>;
};

const HOUR = 3600 * 1000;

export async function computeVerificationMetrics(windowDays = 7): Promise<VerificationMetrics> {
  const since = new Date(Date.now() - windowDays * 24 * HOUR);

  const [
    started,
    approvals,
    rejected,
    expired,
    faceRuns,
    faceStatusRows,
    queued,
    oldestQueued,
    rotations,
    deadLettered,
    duplicateRows,
    appealsSubmitted,
    appealsApproved,
    appealsRejected,
    adverseOutcomes,
    postGrantSuspensions,
    grants,
    riskRows,
    adverseCountries,
    stripeHealth,
    faceHealthMock,
    faceHealthAws,
  ] = await Promise.all([
    db.verification.count({ where: { type: "PHOTO", createdAt: { gte: since } } }),
    db.verification.findMany({
      where: { type: "PHOTO", status: "APPROVED", statusChangedAt: { gte: since } },
      select: { createdAt: true, statusChangedAt: true },
    }),
    db.verification.count({
      where: { type: "PHOTO", status: "REJECTED", statusChangedAt: { gte: since } },
    }),
    db.verification.count({
      where: { type: "PHOTO", status: "EXPIRED", statusChangedAt: { gte: since } },
    }),
    db.verificationAuditEvent.count({
      where: { eventType: "face_check_run", createdAt: { gte: since } },
    }),
    db.profilePhotoVerification.groupBy({
      by: ["status"],
      _count: { _all: true },
      where: { updatedAt: { gte: since } },
    }),
    db.profilePhotoVerification.count({ where: { status: "QUEUED" } }),
    db.profilePhotoVerification.findFirst({
      where: { status: "QUEUED" },
      orderBy: { updatedAt: "asc" },
      select: { updatedAt: true },
    }),
    db.verificationAuditEvent.count({
      where: { eventType: "face_reference_rotated", createdAt: { gte: since } },
    }),
    db.verificationAuditEvent.count({
      where: { eventType: "face_dead_letter", createdAt: { gte: since } },
    }),
    db.profilePhotoVerification.groupBy({
      by: ["duplicateClass"],
      _count: { _all: true },
      where: { duplicateCheckedAt: { gte: since } },
    }),
    db.appeal.count({ where: { createdAt: { gte: since } } }),
    db.appeal.count({ where: { status: "APPROVED", reviewedAt: { gte: since } } }),
    db.appeal.count({ where: { status: "REJECTED", reviewedAt: { gte: since } } }),
    db.verificationAuditEvent.count({
      where: {
        eventType: { in: ["face_check_run", "face_auto_suspend"] },
        newStatus: { in: ["REJECTED", "SUSPENDED"] },
        createdAt: { gte: since },
      },
    }),
    db.verificationAuditEvent.count({
      where: {
        eventType: { in: ["face_admin_suspend", "face_auto_suspend"] },
        createdAt: { gte: since },
      },
    }),
    db.verificationAuditEvent.count({
      where: { eventType: "face_check_run", newStatus: "AUTO_VERIFIED", createdAt: { gte: since } },
    }),
    db.profilePhotoVerification.findMany({
      where: { updatedAt: { gte: since } },
      select: { riskLevel: true },
      take: 5000,
    }),
    db.profile.groupBy({
      by: ["country"],
      _count: { _all: true },
      where: {
        user: {
          profilePhotoVerification: { is: { status: { in: ["REJECTED", "SUSPENDED"] } } },
        },
      },
    }),
    providerHealthState("stripe_identity"),
    providerHealthState("face_match:mock"),
    providerHealthState("face_match:aws_rekognition_faces"),
  ]);

  const rate = (part: number, whole: number) =>
    whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
  const statusCount = (status: string) =>
    faceStatusRows.find((r) => r.status === status)?._count._all ?? 0;

  const avgApprovalSeconds =
    approvals.length > 0
      ? Math.round(
          approvals.reduce(
            (sum, v) =>
              sum + ((v.statusChangedAt ?? v.createdAt).getTime() - v.createdAt.getTime()),
            0,
          ) /
            approvals.length /
            1000,
        )
      : null;

  const risk: Record<RiskBand, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  for (const row of riskRows) risk[bandFromScore(row.riskLevel * 10)] += 1;

  const duplicates: Record<string, number> = {};
  for (const row of duplicateRows) duplicates[row.duplicateClass] = row._count._all;

  const adverseByCountry: Record<string, number> = {};
  for (const row of adverseCountries) {
    if (row.country) adverseByCountry[row.country] = row._count._all;
  }

  return {
    windowDays,
    identity: {
      started,
      approved: approvals.length,
      rejected,
      expired,
      successRate: rate(approvals.length, approvals.length + rejected + expired),
      avgApprovalSeconds,
    },
    face: {
      runs: faceRuns,
      autoVerified: statusCount("AUTO_VERIFIED"),
      manualReview: statusCount("MANUAL_REVIEW"),
      rejected: statusCount("REJECTED"),
      suspended: statusCount("SUSPENDED"),
      manualReviewRate: rate(statusCount("MANUAL_REVIEW"), faceRuns),
      queueDepth: queued,
      oldestQueuedMinutes: oldestQueued
        ? Math.round((Date.now() - oldestQueued.updatedAt.getTime()) / 60000)
        : null,
      referenceRotations: rotations,
      deadLettered,
    },
    duplicates,
    appeals: {
      submitted: appealsSubmitted,
      approved: appealsApproved,
      rejected: appealsRejected,
      appealRate: rate(appealsSubmitted, adverseOutcomes),
    },
    quality: {
      falsePositiveRate: rate(appealsApproved, adverseOutcomes),
      falseNegativeRate: rate(postGrantSuspensions, grants + postGrantSuspensions),
    },
    risk,
    providers: {
      stripe_identity: stripeHealth,
      "face_match:mock": faceHealthMock,
      "face_match:aws_rekognition_faces": faceHealthAws,
    },
    adverseByCountry,
  };
}

/**
 * Alert evaluation (cron): each rule fires an ops alert at most once per
 * day (dedupeKey). Thresholds env-tunable.
 */
export async function evaluateVerificationAlerts(): Promise<string[]> {
  const num = (env: string | undefined, fallback: number) => {
    const v = Number(env);
    return Number.isFinite(v) ? v : fallback;
  };
  const metrics = await computeVerificationMetrics(1);
  const fired: string[] = [];
  const { raiseOpsAlert, resolveOpsAlert } = await import("@/lib/services/provider-resilience");
  const fire = async (kind: string, detail: string) => {
    fired.push(kind);
    await raiseOpsAlert(kind, detail);
  };
  // Resolved notifications: kinds that fired within the last day but are
  // clear this evaluation get a one-time "resolved" on the external channel.
  const resolveIfWasFiring = async (kind: string) => {
    const wasFiring = await db.verificationAuditEvent.findFirst({
      where: {
        eventType: "ops_alert",
        reasonCode: kind,
        createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) },
      },
      select: { id: true },
    });
    if (wasFiring) await resolveOpsAlert(kind);
  };

  let anyProviderTrouble = false;
  for (const [provider, state] of Object.entries(metrics.providers)) {
    if (state === "UNAVAILABLE") {
      anyProviderTrouble = true;
      await fire("provider_down", `${provider} is UNAVAILABLE - verifications are parking safely.`);
    } else if (state === "DEGRADED") {
      anyProviderTrouble = true;
      await fire("provider_degraded", `${provider} is DEGRADED - watch the queue.`);
    }
  }
  if (!anyProviderTrouble) await resolveIfWasFiring("provider_down");
  const stallMin = num(process.env.ALERT_QUEUE_STALL_MINUTES, 60);
  if ((metrics.face.oldestQueuedMinutes ?? 0) > stallMin) {
    await fire(
      "queue_stalled",
      `Oldest queued face job is ${metrics.face.oldestQueuedMinutes} min old (threshold ${stallMin}).`,
    );
  }
  if (metrics.identity.started > num(process.env.ALERT_VERIFICATION_SPIKE, 500)) {
    await fire("verification_spike", `${metrics.identity.started} verifications started in 24h.`);
  }
  if (metrics.appeals.submitted > num(process.env.ALERT_APPEAL_SPIKE, 25)) {
    await fire("appeal_spike", `${metrics.appeals.submitted} appeals submitted in 24h.`);
  }
  const fpMax = num(process.env.ALERT_FALSE_POSITIVE_PCT, 20);
  if ((metrics.quality.falsePositiveRate ?? 0) > fpMax) {
    await fire(
      "false_positive_spike",
      `Overturn rate ${metrics.quality.falsePositiveRate}% exceeds ${fpMax}% - check thresholds.`,
    );
  }
  const dlqMax = num(process.env.ALERT_DLQ_MAX, 0);
  if (metrics.face.deadLettered > dlqMax) {
    await fire(
      "face_dead_letter",
      `${metrics.face.deadLettered} job(s) dead-lettered in 24h (threshold ${dlqMax}).`,
    );
  }

  // Abnormal decision rates (from the same 24h window).
  const suspMax = num(process.env.ALERT_SUSPENSION_MAX, 25);
  if (metrics.face.suspended > suspMax) {
    await fire(
      "suspension_spike",
      `${metrics.face.suspended} badges suspended in 24h (threshold ${suspMax}).`,
    );
  }
  const mrMax = num(process.env.ALERT_MANUAL_REVIEW_PCT, 40);
  if ((metrics.face.manualReviewRate ?? 0) > mrMax) {
    await fire(
      "manual_review_spike",
      `Manual-review rate ${metrics.face.manualReviewRate}% exceeds ${mrMax}%.`,
    );
  }

  // Config/state rules (env + adapter state; no metrics query). These
  // catch a misconfigured or killed provider even when nothing has
  // processed. Evaluated in the provider layer so this module stays
  // provider-agnostic - we only fire the normalized kinds it returns.
  const { evaluateProviderConfigAlerts } = await import("@/lib/services/face-match-providers");
  const config = await evaluateProviderConfigAlerts();
  for (const a of config.fire) await fire(a.kind, a.detail);
  for (const k of config.resolve) await resolveIfWasFiring(k);

  return fired;
}
