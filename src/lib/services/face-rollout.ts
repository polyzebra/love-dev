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

/** Country gate: empty allowlist = all; otherwise the user's country must
 *  be listed. A missing country is refused when an allowlist is set. */
export function countryEligible(
  country: string | null | undefined,
  cfg: ReturnType<typeof faceRolloutConfig> = faceRolloutConfig(),
): boolean {
  if (cfg.countryAllowlist.length === 0) return true;
  if (!country) return false;
  return cfg.countryAllowlist.includes(country.trim().toUpperCase());
}

/**
 * Cohort eligibility for the face layer (percent + country). Existing
 * verified jobs keep running regardless (never strand a user mid-flow);
 * this gates NEW enqueues only.
 */
export function isFaceCohortEligible(userId: string, country: string | null | undefined): boolean {
  const cfg = faceRolloutConfig();
  return countryEligible(country, cfg) && userInPercentCohort(userId, cfg.percent);
}

/**
 * SERVER-ONLY internal rollout allowlist (`FACE_INTERNAL_USER_ALLOWLIST`):
 * a comma-separated list of STABLE user IDs (never emails, never a
 * NEXT_PUBLIC var) that may be admitted while FACE_VERIFICATION_PERCENT=0,
 * for internal AWS rehearsal. It NEVER bypasses the provider/emergency/
 * legal/consent gates - it only substitutes for the percentage cohort.
 * Entries containing "@" (accidental emails) are ignored - IDs only.
 */
export function faceInternalAllowlist(): Set<string> {
  return new Set(
    (process.env.FACE_INTERNAL_USER_ALLOWLIST ?? "")
      .split(",")
      .map((raw) => raw.trim())
      .filter((raw) => raw.length > 0 && !raw.includes("@")),
  );
}

export function isFaceInternalUser(userId: string): boolean {
  const id = userId?.trim();
  return id ? faceInternalAllowlist().has(id) : false;
}

/** Whether an internal-allowlisted user may bypass the country allowlist.
 *  Default OFF - internal admission still respects country unless the
 *  rollout policy explicitly grants the override. */
function internalOverridesCountry(): boolean {
  return process.env.FACE_INTERNAL_ALLOWLIST_COUNTRY_OVERRIDE === "1";
}

/**
 * Active biometric consent for the face layer: the canonical job row holds
 * consentAt AND the CURRENT consent version. Withdrawn (consentAt cleared)
 * or stale-version consent is NOT active - biometrics are never processed
 * without current consent. Read lazily (avoids a face-verification <-> rollout
 * import cycle); callers granting consent in the same request pass
 * hasActiveConsent explicitly instead.
 */
export async function userHasActiveFaceConsent(userId: string): Promise<boolean> {
  const [{ db }, { BIOMETRIC_CONSENT_VERSION }] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/services/face-verification"),
  ]);
  const row = await db.profilePhotoVerification.findUnique({
    where: { userId },
    select: { consentAt: true, consentVersion: true },
  });
  return Boolean(row?.consentAt) && row?.consentVersion === BIOMETRIC_CONSENT_VERSION;
}

/** Canonical environment name (staging vs production) for region/session
 *  binding. FACE_ENVIRONMENT overrides; otherwise derived from NODE_ENV. */
export function faceEnvironment(): string {
  return (
    process.env.FACE_ENVIRONMENT?.trim() ||
    (process.env.NODE_ENV === "production" ? "production" : "staging")
  );
}

/**
 * The instant kill switch (H2). ONE source of truth, checked by admission
 * AND by every processing/enrollment path (run, sweep, liveness consume), so
 * flipping it to "1" halts new admission, in-flight biometric processing, and
 * enrollment - not merely new admission.
 */
export function faceEmergencyDisabled(): boolean {
  return process.env.FACE_EMERGENCY_DISABLE === "1";
}

/** Parse a comma-separated approved-versions env into a trimmed, non-empty list. */
function splitApprovedVersions(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export type FaceLegalGateResult = { ok: boolean; missing: string[] };

/**
 * H4 - THE canonical RUNTIME legal/compliance gate for the MATCH layer. Pure
 * env read, side-effect free, fail-closed. Enforced at provider resolution in
 * production (getFaceMatchProvider), so the whole face layer stays dormant
 * unless EVERY recorded approval exists:
 *   - FACE_LEGAL_APPROVED_VERSIONS  (counsel-approved allowlist, non-empty)
 *   - FACE_LEGAL_APPROVAL_VERSION   (supplied AND a member of the allowlist)
 *   - FACE_AWS_DPA_CONFIRMED=1       (executed data-processing agreement)
 *   - FACE_CALIBRATION_APPROVED=1 + FACE_CALIBRATION_VERSION (approved calibration)
 *   - FACE_EMERGENCY_DISABLE not set (kill switch OFF)
 * Previously these lived ONLY in the rehearsal preflight; they now bind
 * production runtime independently. `missing` lists non-secret env keys only.
 */
export function faceMatchLegalGate(): FaceLegalGateResult {
  const missing: string[] = [];
  const approved = splitApprovedVersions(process.env.FACE_LEGAL_APPROVED_VERSIONS);
  const supplied = process.env.FACE_LEGAL_APPROVAL_VERSION?.trim() || "";
  if (approved.length === 0) missing.push("FACE_LEGAL_APPROVED_VERSIONS");
  if (!supplied) missing.push("FACE_LEGAL_APPROVAL_VERSION");
  else if (!approved.includes(supplied)) missing.push("FACE_LEGAL_APPROVAL_VERSION:not_approved");
  if (process.env.FACE_AWS_DPA_CONFIRMED !== "1") missing.push("FACE_AWS_DPA_CONFIRMED");
  if (process.env.FACE_CALIBRATION_APPROVED !== "1") missing.push("FACE_CALIBRATION_APPROVED");
  if (!process.env.FACE_CALIBRATION_VERSION?.trim()) missing.push("FACE_CALIBRATION_VERSION");
  if (faceEmergencyDisabled()) missing.push("FACE_EMERGENCY_DISABLE");
  return { ok: missing.length === 0, missing };
}

/**
 * H4 - THE canonical RUNTIME legal gate for the BINDING layer. Binding is
 * downstream of matching, so it requires the FULL match-layer compliance PLUS
 * its own counsel-approved binding-version allowlist:
 *   - FACE_BINDING_LEGAL_APPROVED_VERSIONS  (allowlist, non-empty)
 *   - FACE_BINDING_LEGAL_APPROVAL_VERSION    (supplied AND a member)
 * Enforced in production by humanReviewConfigured(). Fail-closed.
 */
export function faceBindingLegalGate(): FaceLegalGateResult {
  const missing = faceMatchLegalGate().missing.slice();
  const approved = splitApprovedVersions(process.env.FACE_BINDING_LEGAL_APPROVED_VERSIONS);
  const supplied = process.env.FACE_BINDING_LEGAL_APPROVAL_VERSION?.trim() || "";
  if (approved.length === 0) missing.push("FACE_BINDING_LEGAL_APPROVED_VERSIONS");
  if (!supplied) missing.push("FACE_BINDING_LEGAL_APPROVAL_VERSION");
  else if (!approved.includes(supplied))
    missing.push("FACE_BINDING_LEGAL_APPROVAL_VERSION:not_approved");
  return { ok: missing.length === 0, missing };
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
  opts: {
    country?: string | null;
    isRecovery?: boolean;
    /** Set when consent is being granted in THIS request (the liveness/
     *  consent flow stamps it right after admit). Otherwise stored consent
     *  is read from the job row. Explicit false forces "no consent". */
    hasActiveConsent?: boolean;
  } = {},
): Promise<AdmitDecision> {
  const cfg = faceRolloutConfig();

  // 1. Provider configured. Hard gate (applies to recovery too - never
  //    process biometrics while the provider is off).
  const { isFaceMatchConfigured } = await import("@/lib/services/face-match-providers");
  if (!isFaceMatchConfigured()) return { admit: false, reason: "provider_disabled" };

  // 2. Emergency disable OFF. Overrides EVERYTHING, including the internal
  //    allowlist and recovery - the instant kill switch.
  if (faceEmergencyDisabled()) return { admit: false, reason: "emergency_disable" };

  // 3. Production legal approval valid. The internal allowlist NEVER
  //    bypasses this - no biometric processing in production without a
  //    recorded legal approval version.
  if (
    process.env.NODE_ENV === "production" &&
    process.env.FACE_MATCH_PROVIDER?.trim().toLowerCase() === "aws_rekognition_faces" &&
    !cfg.legalApprovalVersion
  ) {
    return { admit: false, reason: "legal_approval_missing" };
  }

  // 4. Active user consent. Never process biometrics without CURRENT
  //    consent - applies to internal, cohort AND recovery. Callers granting
  //    consent in this request pass hasActiveConsent; else read stored.
  const hasConsent = opts.hasActiveConsent ?? (await userHasActiveFaceConsent(userId));
  if (!hasConsent) return { admit: false, reason: "consent_missing" };

  // Recovery of already-admitted work has cleared gates 1-4; it is in.
  if (opts.isRecovery) return { admit: true, reason: "recovery" };

  // 5. Internal allowlist admission - admits even at FACE_VERIFICATION_PERCENT=0
  //    (internal AWS rehearsal). Still respects the country allowlist unless
  //    the rollout policy explicitly grants the override.
  if (isFaceInternalUser(userId)) {
    if (!internalOverridesCountry() && !countryEligible(opts.country, cfg)) {
      return { admit: false, reason: "country_excluded" };
    }
    return { admit: true, reason: "internal_allowlist" };
  }

  // 6. Percentage cohort.
  if (!userInPercentCohort(userId, cfg.percent)) return { admit: false, reason: "cohort_excluded" };

  // 7. Country allowlist.
  if (!countryEligible(opts.country, cfg)) return { admit: false, reason: "country_excluded" };

  return { admit: true, reason: "cohort_admitted" };
}
