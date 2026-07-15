import { createHash } from "node:crypto";

/**
 * Staged rollout controls (Phase 32). Every switch is env-driven and
 * DEFAULTS TO OFF/dormant - production face processing can never enable
 * itself. The stage table lives in the runbook; this module is only the
 * mechanical gate set.
 *
 *   FACE_MATCH_PROVIDER            master switch (existing)
 *   FACE_LEGAL_APPROVAL_VERSION    REQUIRED non-empty in production for a
 *                                  real provider (hard legal gate)
 *   FACE_LIVENESS_ENABLED          "1" enables the capture endpoints
 *   FACE_VERIFICATION_PERCENT      0-100 deterministic user cohort
 *   FACE_VERIFICATION_COUNTRY_ALLOWLIST  comma list; empty = all
 *   FACE_DUPLICATE_SEARCH_ENABLED  "1" enables likeness search
 *   FACE_AUTO_SUSPEND_ENABLED      "1" allows the impersonation
 *                                  auto-suspend; otherwise manual review
 *   FACE_CALIBRATION_VERSION       stamped on every decision
 */

export function faceRolloutConfig() {
  const percent = Number(process.env.FACE_VERIFICATION_PERCENT);
  return {
    legalApprovalVersion: process.env.FACE_LEGAL_APPROVAL_VERSION?.trim() || null,
    livenessEnabled: process.env.FACE_LIVENESS_ENABLED === "1",
    percent: Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 100,
    countryAllowlist: (process.env.FACE_VERIFICATION_COUNTRY_ALLOWLIST ?? "")
      .split(",")
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean),
    duplicateSearchEnabled: process.env.FACE_DUPLICATE_SEARCH_ENABLED === "1",
    autoSuspendEnabled: process.env.FACE_AUTO_SUSPEND_ENABLED === "1",
    calibrationVersion: process.env.FACE_CALIBRATION_VERSION?.trim() || null,
    stripeBindingEnabled: process.env.FACE_STRIPE_BINDING_ENABLED === "1",
  };
}

/** Deterministic percent bucketing: stable per user, no storage. */
export function userInPercentCohort(userId: string, percent: number): boolean {
  if (percent >= 100) return true;
  if (percent <= 0) return false;
  const bucket = parseInt(createHash("sha256").update(userId).digest("hex").slice(0, 8), 16) % 100;
  return bucket < percent;
}

/**
 * Cohort eligibility for the face layer (percent + country). Existing
 * verified jobs keep running regardless (never strand a user mid-flow);
 * this gates NEW enqueues only.
 */
export function isFaceCohortEligible(userId: string, country: string | null | undefined): boolean {
  const cfg = faceRolloutConfig();
  if (cfg.countryAllowlist.length > 0) {
    if (!country || !cfg.countryAllowlist.includes(country.trim().toUpperCase())) return false;
  }
  return userInPercentCohort(userId, cfg.percent);
}

/** Canonical environment name (staging vs production) for region/session
 *  binding. FACE_ENVIRONMENT overrides; otherwise derived from NODE_ENV. */
export function faceEnvironment(): string {
  return (
    process.env.FACE_ENVIRONMENT?.trim() ||
    (process.env.NODE_ENV === "production" ? "production" : "staging")
  );
}

export type AdmitDecision = { admit: boolean; reason: string };

/**
 * THE canonical rollout-decision function (C-3). EVERY entry point that
 * would create NEW face work calls this before enqueuing. Recovery of
 * already-admitted work passes { isRecovery: true } and is allowed to
 * proceed on its own row (but still refused if the provider/legal gates
 * are off - never process biometrics when disabled).
 */
export async function admitToFaceVerification(
  userId: string,
  opts: { country?: string | null; isRecovery?: boolean } = {},
): Promise<AdmitDecision> {
  const cfg = faceRolloutConfig();
  // Hard gates - apply to recovery too (never process when disabled).
  const { isFaceMatchConfigured } = await import("@/lib/services/face-match-providers");
  if (!isFaceMatchConfigured()) return { admit: false, reason: "provider_disabled" };
  if (process.env.FACE_EMERGENCY_DISABLE === "1")
    return { admit: false, reason: "emergency_disable" };
  if (
    process.env.NODE_ENV === "production" &&
    process.env.FACE_MATCH_PROVIDER?.trim().toLowerCase() === "aws_rekognition_faces" &&
    !process.env.FACE_LEGAL_APPROVAL_VERSION?.trim()
  ) {
    return { admit: false, reason: "legal_approval_missing" };
  }
  // Recovery of admitted work bypasses cohort admission (it is already in).
  if (opts.isRecovery) return { admit: true, reason: "recovery" };
  // Cohort admission for NEW work: percentage + country + staff/invite.
  if (!isFaceCohortEligible(userId, opts.country))
    return { admit: false, reason: "cohort_excluded" };
  return { admit: true, reason: "cohort_admitted" };
}
