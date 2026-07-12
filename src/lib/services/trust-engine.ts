import { db } from "@/lib/db";
import type { SafetyRecommendedAction } from "@/generated/prisma/enums";
import { isDisposableEmail } from "@/lib/auth/disposable-domains";
import { RISK_THRESHOLD } from "@/lib/auth/risk";
import { collectFraudSignals } from "@/lib/services/fraud-signals";
import { getVerificationState } from "@/lib/services/verification";

/**
 * Trust engine - the composite safety risk profile for one account,
 * built ONLY from signals that exist in our own data. Server-side only:
 * nothing here (scores, reasons, recommendations) is ever exposed to the
 * account's owner or any non-staff surface.
 *
 * Relationship to the OTHER engines (deliberate separation of concerns):
 *  - src/lib/auth/risk.ts     = LOGIN risk (per sign-in; owns User.riskScore)
 *  - src/lib/services/scam.ts = behavioural spam score (owns User.scamScore)
 *  - THIS module              = the composite across everything, persisted
 *    to User.safetyRiskScore/safetyRiskReasons/safetyRecommendedAction/
 *    safetyRiskUpdatedAt and consumed by admins + phase-2 dashboards.
 * The verification-derived trustScore stays DERIVED (verification.ts
 * TRUST_WEIGHTS) - it is returned live here, never stored.
 *
 * Recompute triggers: report creation, photo rejection, violations,
 * appeal decisions (see recomputeTrustForEvent) + the admin recompute
 * action. Never on the hot path.
 */

export type TrustSignal = { name: string; points: number };

export type TrustProfile = {
  userId: string;
  /** Composite 0-100 risk (higher = riskier). */
  riskScore: number;
  /** Verification-derived 0-100 trust (from verification.ts, never stored). */
  trustScore: number;
  recommendedAction: SafetyRecommendedAction;
  /** Signal names that fired - auditable, staff-only. */
  reasons: string[];
  signals: TrustSignal[];
};

/** Signal weights - additive, capped at 100. All from real data. */
export const TRUST_ENGINE_WEIGHTS = {
  /** Per photo auto/human-REJECTED (cap below). */
  photo_rejected: 10,
  photo_rejected_cap: 30,
  /** Per distinct reporter with an OPEN/ACTION_TAKEN report (cap below). */
  reported: 10,
  reported_cap: 30,
  /** Per non-reversed violation on file (cap below). */
  violation: 15,
  violation_cap: 45,
  /** Device hash shared with at least one OTHER account. */
  device_multi_account: 20,
  /** Disposable email domain. */
  disposable_email: 10,
  /** Login risk engine currently at/above its own threshold. */
  login_risk_high: 10,
  /** Admin flag (riskReason starting "admin:") - a human said "watch this". */
  admin_flagged: 30,
  /** At least one refunded payment (dispute placeholder - see note). */
  payment_refunded: 10,
} as const;

/** scamScore (0-100) contributes at this ratio (behavioural spam signals). */
export const SCAM_SCORE_RATIO = 0.3;

/**
 * Pure mapping from the composite score + fired signals to ONE recommended
 * action. Recommendations only - execution is either automated through the
 * graduated ladder (trust-safety.ts) or a human decision; BAN_ACCOUNT here
 * can only ever be carried out by a person.
 */
export function recommendedActionFor(
  score: number,
  reasons: string[],
): SafetyRecommendedAction {
  const has = (prefix: string) => reasons.some((r) => r.startsWith(prefix));
  if (score >= 85) return "BAN_ACCOUNT";
  if (score >= 70) return "SUSPEND_ACCOUNT";
  if (score >= 55) return "SEND_TO_MANUAL_REVIEW";
  if (score >= 45) return has("scam_behaviour") || has("reported") ? "LIMIT_MESSAGING" : "HIDE_PROFILE";
  if (score >= 30) return has("photo_rejected") ? "REQUIRE_PHOTO_VERIFICATION" : "SHOW_WARNING";
  if (score >= 15) return "SHOW_WARNING";
  return "NO_ACTION";
}

/**
 * Compute + persist the composite trust profile for one user.
 */
export async function computeTrustProfile(userId: string): Promise<TrustProfile | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      phoneE164: true,
      riskScore: true,
      riskReason: true,
      scamScore: true,
      lastDeviceHash: true,
      lastLoginIpHash: true,
    },
  });
  if (!user) return null;

  const [rejectedPhotos, reporters, violations, refundedPayments, verification, fraudSignals] =
    await Promise.all([
      db.photo.count({ where: { userId, moderation: "REJECTED" } }),
      db.report.findMany({
        where: { reportedId: userId, status: { in: ["OPEN", "ACTION_TAKEN"] } },
        select: { reporterId: true },
        distinct: ["reporterId"],
      }),
      db.accountViolation.count({ where: { userId, reversedAt: null } }),
      db.payment.count({ where: { userId, status: "REFUNDED" } }),
      getVerificationState(userId),
      // Fraud plane (fraud-signals.ts): device reuse tiers, signup/login
      // velocity, email alias reuse, verification failures, banned-phone
      // match, VPN/TOR (real intel only), fake-profile scoring. The old
      // inline device_multi_account check lives there now (same signal
      // name at the 2-account tier).
      collectFraudSignals({
        id: userId,
        email: user.email,
        phoneE164: user.phoneE164,
        riskReason: user.riskReason,
        lastLoginIpHash: user.lastLoginIpHash,
      }),
    ]);

  const signals: TrustSignal[] = [...fraudSignals];
  const add = (name: string, points: number) => {
    if (points > 0) signals.push({ name, points });
  };
  const w = TRUST_ENGINE_WEIGHTS;

  if (rejectedPhotos > 0) {
    add(
      `photo_rejected_x${rejectedPhotos}`,
      Math.min(rejectedPhotos * w.photo_rejected, w.photo_rejected_cap),
    );
  }
  if (reporters.length > 0) {
    add(`reported_x${reporters.length}`, Math.min(reporters.length * w.reported, w.reported_cap));
  }
  if (violations > 0) {
    add(`violation_x${violations}`, Math.min(violations * w.violation, w.violation_cap));
  }
  if (isDisposableEmail(user.email)) add("disposable_email", w.disposable_email);
  if (user.riskScore >= RISK_THRESHOLD) add("login_risk_high", w.login_risk_high);
  if (user.riskReason?.startsWith("admin:")) add("admin_flagged", w.admin_flagged);
  // Payment disputes: no dispute webhook exists yet - REFUNDED payments are
  // the honest placeholder signal until Stripe dispute events are wired.
  if (refundedPayments > 0) add("payment_refunded", w.payment_refunded);
  // Behavioural spam (scam.ts owns the sub-signals: message velocity,
  // copy-paste blasts, link spam, blocks). Uses the stored score - call
  // computeScamScore first when freshness matters.
  const scamPoints = Math.round(user.scamScore * SCAM_SCORE_RATIO);
  if (scamPoints > 0) add(`scam_behaviour_${user.scamScore}`, scamPoints);

  const riskScore = Math.min(
    100,
    signals.reduce((sum, s) => sum + s.points, 0),
  );
  const reasons = signals.map((s) => s.name);
  const recommendedAction = recommendedActionFor(riskScore, reasons);

  await db.user.update({
    where: { id: userId },
    data: {
      safetyRiskScore: riskScore,
      safetyRiskReasons: reasons.join(","),
      safetyRecommendedAction: recommendedAction,
      safetyRiskUpdatedAt: new Date(),
    },
  });

  return {
    userId,
    riskScore,
    trustScore: verification?.trustScore ?? 0,
    recommendedAction,
    reasons,
    signals,
  };
}

export type TrustEvent =
  | "report_created"
  | "photo_rejected"
  | "violation_added"
  | "appeal_decided"
  | "admin_recompute";

/**
 * Event-driven recompute - fire-and-forget from the mutation paths (report
 * creation, photo pipeline, appeals). Never throws: a scoring failure must
 * not break the triggering operation.
 */
export async function recomputeTrustForEvent(userId: string, event: TrustEvent): Promise<void> {
  try {
    await computeTrustProfile(userId);
  } catch (error) {
    console.warn(`[trust-engine] recompute (${event}) failed for ${userId}:`, error);
  }
}
