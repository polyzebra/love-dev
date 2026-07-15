import { db } from "@/lib/db";
import { computeTrustProfile } from "@/lib/services/trust-engine";

/**
 * Verification Risk Engine (threat-model Phase 2).
 *
 * ONE aggregation point for every verification-adjacent decision. It
 * COMPOSES the existing canonical engines - trust-engine (which already
 * folds in fraud-signals: device reuse, velocity, IP intel, email reuse,
 * bans, reports, violations, scam behaviour) - and adds the face-layer
 * signals (identity state, face decision, duplicate classification,
 * reference lifecycle, manipulation flags, appeal history). No business
 * logic is duplicated: trust scoring lives in trust-engine, face policy
 * lives in face-verification; this module only WEIGHS and BANDS.
 *
 * Contract:
 *  - decisions never rest on face comparison alone: callers consult the
 *    band (e.g. CRITICAL blocks auto-verification, forces manual review)
 *  - output is ONLY a band + normalized signal names - raw vendor
 *    scores, similarities and embeddings never leave this module (they
 *    never even enter it; inputs are already classifications/bands)
 *  - every threshold and weight is configuration-driven (env) with
 *    documented defaults
 */

export type RiskBand = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/**
 * RISK SIGNAL REGISTRY (Phase 21) - the canonical ownership table. Every
 * signal has exactly ONE scoring owner; equivalent events never score
 * twice. Deduplication keys are STABLE code values (enum/source columns,
 * never display text). Registry is consumed by docs and pinned by tests.
 */
export const RISK_SIGNAL_REGISTRY = [
  // --- owner: trust-engine (content/behaviour plane) ---
  {
    name: "photo_rejected",
    owner: "trust-engine",
    category: "content",
    severity: "medium",
    persistence: "while photo rejected",
    dedupe: "per photo via Photo.moderation",
    scoreable: true,
    informational: false,
  },
  {
    name: "reported",
    owner: "trust-engine",
    category: "social",
    severity: "medium",
    persistence: "while report open",
    dedupe: "distinct reporterId",
    scoreable: true,
    informational: false,
  },
  {
    name: "violation",
    owner: "trust-engine",
    category: "enforcement",
    severity: "high",
    persistence: "until reversed",
    dedupe: "per violation row, EXCLUDES source=face_verification",
    scoreable: true,
    informational: false,
  },
  {
    name: "device_multi_account",
    owner: "fraud-signals",
    category: "device",
    severity: "medium",
    persistence: "while shared",
    dedupe: "per device hash tier",
    scoreable: true,
    informational: false,
  },
  {
    name: "disposable_email",
    owner: "fraud-signals",
    category: "identity",
    severity: "low",
    persistence: "account lifetime",
    dedupe: "boolean",
    scoreable: true,
    informational: false,
  },
  {
    name: "login_risk_high",
    owner: "fraud-signals",
    category: "session",
    severity: "medium",
    persistence: "while elevated",
    dedupe: "boolean",
    scoreable: true,
    informational: false,
  },
  {
    name: "admin_flagged",
    owner: "trust-engine",
    category: "staff",
    severity: "high",
    persistence: "until cleared",
    dedupe: "boolean (riskReason prefix)",
    scoreable: true,
    informational: false,
  },
  {
    name: "payment_refunded",
    owner: "trust-engine",
    category: "payment",
    severity: "low",
    persistence: "account lifetime",
    dedupe: "per refunded payment",
    scoreable: true,
    informational: false,
  },
  // --- owner: risk-engine face plane (this module) ---
  {
    name: "identity_unverified",
    owner: "risk-engine",
    category: "verification",
    severity: "low",
    persistence: "until verified",
    dedupe: "boolean",
    scoreable: true,
    informational: false,
  },
  {
    name: "face_rejected",
    owner: "risk-engine",
    category: "verification",
    severity: "high",
    persistence: "while status REJECTED",
    dedupe: "job status enum (violation row is source-excluded upstream)",
    scoreable: true,
    informational: false,
  },
  {
    name: "face_suspended",
    owner: "risk-engine",
    category: "verification",
    severity: "high",
    persistence: "while status SUSPENDED",
    dedupe: "job status enum",
    scoreable: true,
    informational: false,
  },
  {
    name: "manipulation_flagged",
    owner: "risk-engine",
    category: "verification",
    severity: "high",
    persistence: "while photo live",
    dedupe: "classification enum, LIVE photos only",
    scoreable: true,
    informational: false,
  },
  {
    name: "other_person_photos",
    owner: "risk-engine",
    category: "verification",
    severity: "medium",
    persistence: "while photos live",
    dedupe: "per (photoId, mediaVersion), LIVE photos only, capped",
    scoreable: true,
    informational: false,
  },
  {
    name: "duplicate_impersonation",
    owner: "risk-engine",
    category: "duplicate",
    severity: "critical",
    persistence: "while classified",
    dedupe: "duplicateClass enum (violation row source-excluded)",
    scoreable: true,
    informational: false,
  },
  {
    name: "duplicate_unresolved",
    owner: "risk-engine",
    category: "duplicate",
    severity: "medium",
    persistence: "while classified",
    dedupe: "duplicateClass enum",
    scoreable: true,
    informational: false,
  },
  {
    name: "reference_invalid",
    owner: "risk-engine",
    category: "lifecycle",
    severity: "low",
    persistence: "until re-enrolled",
    dedupe: "referenceStatus enum",
    scoreable: true,
    informational: false,
  },
  {
    name: "appeal_denied",
    owner: "risk-engine",
    category: "appeals",
    severity: "medium",
    persistence: "rolling",
    dedupe: "per REJECTED appeal row, capped",
    scoreable: true,
    informational: false,
  },
] as const;

export type VerificationRisk = {
  band: RiskBand;
  /** Normalized, staff-safe signal names (threat flags). No values. */
  signals: string[];
};

function num(env: string | undefined, fallback: number): number {
  const v = Number(env);
  return Number.isFinite(v) ? v : fallback;
}

/** All knobs env-tunable; defaults documented in the runbook. */
export function riskEngineConfig() {
  return {
    // Band boundaries over the composite 0-100+ score.
    mediumAt: num(process.env.RISK_MEDIUM_AT, 25),
    highAt: num(process.env.RISK_HIGH_AT, 50),
    criticalAt: num(process.env.RISK_CRITICAL_AT, 75),
    // Face-layer weights added ON TOP of the trust-engine composite.
    weights: {
      identity_unverified: num(process.env.RISK_W_IDENTITY_UNVERIFIED, 15),
      face_rejected: num(process.env.RISK_W_FACE_REJECTED, 20),
      face_suspended: num(process.env.RISK_W_FACE_SUSPENDED, 25),
      manipulation_flagged: num(process.env.RISK_W_MANIPULATION, 30),
      other_person_photos: num(process.env.RISK_W_OTHER_PERSON, 10), // per photo, capped
      other_person_cap: num(process.env.RISK_W_OTHER_PERSON_CAP, 30),
      duplicate_impersonation: num(process.env.RISK_W_DUP_IMPERSONATION, 50),
      duplicate_unresolved: num(process.env.RISK_W_DUP_UNRESOLVED, 15),
      reference_invalid: num(process.env.RISK_W_REFERENCE_INVALID, 10),
      appeal_denied: num(process.env.RISK_W_APPEAL_DENIED, 10), // per denial, capped
      appeal_denied_cap: num(process.env.RISK_W_APPEAL_DENIED_CAP, 20),
    },
  };
}

/** Pure banding - exported for tests and for anything holding a score. */
export function bandFromScore(
  score: number,
  cfg: { mediumAt: number; highAt: number; criticalAt: number } = riskEngineConfig(),
): RiskBand {
  if (score >= cfg.criticalAt) return "CRITICAL";
  if (score >= cfg.highAt) return "HIGH";
  if (score >= cfg.mediumAt) return "MEDIUM";
  return "LOW";
}

export type FaceRiskInput = {
  identityVerified: boolean;
  faceStatus:
    "QUEUED" | "CHECKING" | "AUTO_VERIFIED" | "MANUAL_REVIEW" | "REJECTED" | "SUSPENDED" | null;
  duplicateClass:
    | "UNKNOWN"
    | "SELF_RESTORE"
    | "LIKELY_DUPLICATE"
    | "LIKELY_IMPERSONATION"
    | "TWIN_RISK"
    | "FAMILY_RESEMBLANCE"
    | "LOW_CONFIDENCE";
  referenceStatus: "ACTIVE" | "EXPIRING" | "EXPIRED" | "REVOKED" | "DELETED" | "ROTATING" | null;
  manipulationFlaggedPhotos: number;
  otherPersonPhotos: number;
  deniedAppeals: number;
};

/**
 * Pure face-layer scoring - exported for tests. Returns points + fired
 * signal names; the composite adds trust-engine's score on top.
 */
export function scoreFaceSignals(input: FaceRiskInput): { points: number; signals: string[] } {
  const w = riskEngineConfig().weights;
  let points = 0;
  const signals: string[] = [];
  const fire = (name: string, pts: number) => {
    points += pts;
    signals.push(name);
  };

  if (!input.identityVerified) fire("identity_unverified", w.identity_unverified);
  if (input.faceStatus === "REJECTED") fire("face_rejected", w.face_rejected);
  if (input.faceStatus === "SUSPENDED") fire("face_suspended", w.face_suspended);
  if (input.manipulationFlaggedPhotos > 0) fire("manipulation_flagged", w.manipulation_flagged);
  if (input.otherPersonPhotos > 0) {
    fire(
      "other_person_photos",
      Math.min(input.otherPersonPhotos * w.other_person_photos, w.other_person_cap),
    );
  }
  if (input.duplicateClass === "LIKELY_IMPERSONATION") {
    fire("duplicate_impersonation", w.duplicate_impersonation);
  } else if (input.duplicateClass === "TWIN_RISK" || input.duplicateClass === "LIKELY_DUPLICATE") {
    fire("duplicate_unresolved", w.duplicate_unresolved);
  }
  if (
    input.referenceStatus === "EXPIRED" ||
    input.referenceStatus === "REVOKED" ||
    input.referenceStatus === "DELETED"
  ) {
    fire("reference_invalid", w.reference_invalid);
  }
  if (input.deniedAppeals > 0) {
    fire("appeal_denied", Math.min(input.deniedAppeals * w.appeal_denied, w.appeal_denied_cap));
  }
  return { points, signals };
}

/**
 * The composite: trust-engine profile (device/IP/velocity/reports/bans/
 * behaviour - already weighted there) + face-layer signals -> ONE band.
 */
export async function computeVerificationRisk(userId: string): Promise<VerificationRisk> {
  const cfg = riskEngineConfig();

  const [trust, user, job, deniedAppeals] = await Promise.all([
    computeTrustProfile(userId).catch(() => null),
    db.user.findUnique({ where: { id: userId }, select: { photoVerifiedAt: true } }),
    db.profilePhotoVerification.findUnique({
      where: { userId },
      select: {
        status: true,
        duplicateClass: true,
        referenceStatus: true,
        checks: {
          select: { classification: true },
          // LIVE photos only: once a flagged photo is moderation-REJECTED
          // (unpublished), trust-engine's photo_rejected owns that signal -
          // counting the check here too would double-score one photo.
          where: {
            classification: { in: ["MANIPULATION_RISK", "OTHER_PERSON_ONLY"] },
            photo: { moderation: { not: "REJECTED" } },
          },
        },
      },
    }),
    db.appeal.count({ where: { userId, status: "REJECTED" } }),
  ]);

  const face = scoreFaceSignals({
    identityVerified: Boolean(user?.photoVerifiedAt),
    faceStatus: job?.status ?? null,
    duplicateClass: job?.duplicateClass ?? "UNKNOWN",
    referenceStatus: job?.referenceStatus ?? null,
    manipulationFlaggedPhotos:
      job?.checks.filter((c) => c.classification === "MANIPULATION_RISK").length ?? 0,
    otherPersonPhotos:
      job?.checks.filter((c) => c.classification === "OTHER_PERSON_ONLY").length ?? 0,
    deniedAppeals,
  });

  const composite = (trust?.riskScore ?? 0) + face.points;
  const signals = [...(trust?.reasons ?? []), ...face.signals];
  return { band: bandFromScore(composite, cfg), signals };
}
