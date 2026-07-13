import { db } from "@/lib/db";
import type { ModerationCaseType, PhotoModerationResultStatus } from "@/generated/prisma/enums";
import {
  buildModerationChain,
  resolveConfiguredProviders,
} from "@/lib/services/moderation-providers";
import { PHOTOS_BUCKET } from "@/lib/services/photos";
import { enforceGraduated, openModerationCase } from "@/lib/services/trust-safety";
import { storageClient } from "@/lib/storage";

/**
 * Photo moderation - provider architecture.
 *
 * `moderatePhoto(photoId)` is the single automated entry point, called once
 * from POST /api/photos right after the Photo row is created. It picks a
 * provider (env-driven), asks it for a {@link ModerationVerdict}, and applies
 * the verdict transactionally to the row plus an append-only
 * PhotoModerationEvent. Humans act later through the admin queue
 * (/admin/photos), which writes its own events with an actorId.
 *
 * Category surface a real provider is expected to cover (each maps to one or
 * more `labels` on the verdict):
 *  - nudity / sexual content
 *  - violence / weapons / blood
 *  - drugs
 *  - hate symbols
 *  - minors
 *  - text / logos / QR codes
 *  - screenshots / memes
 *  - AI-generated faces
 *  - multiple faces
 *  - no face
 *  - animal instead of a person
 */

export type ModerationDecision = "safe" | "review" | "rejected";

/**
 * Per-category risk scores (0-1) a capable provider returns. Every field is
 * nullable - null means "the provider did not score this", never 0. These
 * are persisted PII-stripped into PhotoModerationResult; NO biometric
 * vectors/embeddings are ever accepted or stored.
 */
export type ModerationScores = {
  adultScore: number | null;
  violenceScore: number | null;
  minorRiskScore: number | null;
  aiGeneratedScore: number | null;
  duplicateMatchScore: number | null;
  reverseImageRisk: number | null;
  confidence: number | null;
};

export const NULL_SCORES: ModerationScores = {
  adultScore: null,
  violenceScore: null,
  minorRiskScore: null,
  aiGeneratedScore: null,
  duplicateMatchScore: null,
  reverseImageRisk: null,
  confidence: null,
};

export type ModerationVerdict = {
  decision: ModerationDecision;
  /** Provider confidence/risk score, or null when no provider scored the image. NEVER fabricated. */
  aiScore: number | null;
  /** null = detection unavailable (e.g. no provider), NOT "no face". */
  faceDetected: boolean | null;
  facesCount: number | null;
  /** Category labels from the surface documented above (or ["unmoderated"]). */
  labels: string[];
  reason?: string;
  /** Per-category risk scores; absent/null when the provider has none. */
  scores?: ModerationScores;
  /** Opaque reference on the provider's side (persisted for traceability). */
  providerReference?: string | null;
};

export type ModerationInput = {
  /** Raw image bytes (card variant) - preferred, since the bucket is private. */
  buffer?: Buffer;
  /** Publicly fetchable URL, if the deployment exposes one to the provider. */
  imageUrl?: string;
};

export type ModerationContext = {
  photoId: string;
  userId: string;
  isCover: boolean;
  mimeType: string | null;
};

export interface ModerationProvider {
  name: string;
  analyze(input: ModerationInput, context: ModerationContext): Promise<ModerationVerdict>;
}

/**
 * Fallback when no moderation provider is configured. Auto-approves so the
 * product remains usable in dev/self-hosted setups, but records the truth:
 * labels ["unmoderated"], reason "no moderation provider configured", and all
 * detection fields null (we never invent scores or face data). Every use is
 * also logged server-side.
 */
export const nullProvider: ModerationProvider = {
  name: "null",
  async analyze(): Promise<ModerationVerdict> {
    return {
      decision: "safe",
      aiScore: null,
      faceDetected: null,
      facesCount: null,
      labels: ["unmoderated"],
      reason: "no moderation provider configured",
    };
  },
};

/** Shape we map a generic external moderation API response from. */
type ExternalModerationResponse = {
  decision?: unknown;
  score?: unknown;
  faceDetected?: unknown;
  facesCount?: unknown;
  labels?: unknown;
  reason?: unknown;
  adultScore?: unknown;
  violenceScore?: unknown;
  minorRiskScore?: unknown;
  aiGeneratedScore?: unknown;
  duplicateMatchScore?: unknown;
  reverseImageRisk?: unknown;
  confidence?: unknown;
  reference?: unknown;
};

function asScore(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

/**
 * INTEGRATION POINT for a real moderation service (AWS Rekognition proxy,
 * Hive, Sightengine, an internal service, ...). Enabled only when BOTH
 * MODERATION_API_URL and MODERATION_API_KEY are set - `pickProvider` never
 * selects it otherwise. POSTs the card-variant bytes (base64) plus context
 * and maps a generic JSON response; anything the service does not return
 * stays null rather than being invented. An unrecognized decision degrades
 * to "review" so a misbehaving provider can only ever add human review,
 * never auto-publish or auto-reject.
 */
export const externalProvider: ModerationProvider = {
  name: "external",
  async analyze(input, context): Promise<ModerationVerdict> {
    const url = process.env.MODERATION_API_URL;
    const key = process.env.MODERATION_API_KEY;
    if (!url || !key) {
      throw new Error("externalProvider called without MODERATION_API_URL/MODERATION_API_KEY");
    }
    if (!input.buffer && !input.imageUrl) {
      throw new Error("externalProvider needs image bytes or a fetchable URL");
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        image: input.buffer ? input.buffer.toString("base64") : undefined,
        imageUrl: input.imageUrl,
        mimeType: "image/webp", // variants are always webp
        context,
      }),
    });
    if (!res.ok) {
      throw new Error(`moderation API responded ${res.status}`);
    }

    const raw = (await res.json()) as ExternalModerationResponse;

    const decision: ModerationDecision =
      raw.decision === "safe" || raw.decision === "rejected" ? raw.decision : "review";

    return {
      decision,
      aiScore: typeof raw.score === "number" && Number.isFinite(raw.score) ? raw.score : null,
      faceDetected: typeof raw.faceDetected === "boolean" ? raw.faceDetected : null,
      facesCount:
        typeof raw.facesCount === "number" && Number.isInteger(raw.facesCount)
          ? raw.facesCount
          : null,
      labels: Array.isArray(raw.labels)
        ? raw.labels.filter((l): l is string => typeof l === "string")
        : [],
      reason: typeof raw.reason === "string" ? raw.reason : undefined,
      // Per-category scores: only what the service actually returned (and
      // only sane 0-1 values) - never invented.
      scores: {
        adultScore: asScore(raw.adultScore),
        violenceScore: asScore(raw.violenceScore),
        minorRiskScore: asScore(raw.minorRiskScore),
        aiGeneratedScore: asScore(raw.aiGeneratedScore),
        duplicateMatchScore: asScore(raw.duplicateMatchScore),
        reverseImageRisk: asScore(raw.reverseImageRisk),
        confidence: asScore(raw.confidence),
      },
      providerReference: typeof raw.reference === "string" ? raw.reference : null,
    };
  },
};

// ---------------------------------------------------------------------------
// Mock provider (dev/tests) - deterministic, env-gated
// ---------------------------------------------------------------------------

export type MockModerationConfig = Partial<ModerationScores> & {
  decision?: ModerationDecision;
  labels?: string[];
  faceDetected?: boolean | null;
  facesCount?: number | null;
};

let mockDefault: MockModerationConfig | null = null;
const mockByUser = new Map<string, MockModerationConfig>();

/**
 * Configure the mock provider (tests / dev scripts). Pass a userId to scope
 * the scores to one uploader; null clears. Env fallback:
 * MOCK_MODERATION_SCORES may hold the same JSON shape.
 */
export function setMockModerationConfig(
  config: MockModerationConfig | null,
  userId?: string,
): void {
  if (userId) {
    if (config) mockByUser.set(userId, config);
    else mockByUser.delete(userId);
    return;
  }
  mockDefault = config;
}

function mockConfigFor(userId: string): MockModerationConfig {
  const fromEnv = (): MockModerationConfig => {
    try {
      return JSON.parse(process.env.MOCK_MODERATION_SCORES ?? "{}") as MockModerationConfig;
    } catch {
      return {};
    }
  };
  return mockByUser.get(userId) ?? mockDefault ?? fromEnv();
}

/**
 * Deterministic mock for dev/tests, selected ONLY when
 * MODERATION_PROVIDER="mock". Returns the configured scores (per-user
 * override -> module default -> MOCK_MODERATION_SCORES env -> benign),
 * identical for identical input - no randomness.
 */
export const mockProvider: ModerationProvider = {
  name: "mock",
  async analyze(_input, context): Promise<ModerationVerdict> {
    const cfg = mockConfigFor(context.userId);
    const scores: ModerationScores = { ...NULL_SCORES, confidence: 1, ...cfg };
    return {
      decision: cfg.decision ?? "safe",
      aiScore: scores.adultScore,
      faceDetected: cfg.faceDetected ?? true,
      facesCount: cfg.facesCount ?? 1,
      labels: cfg.labels ?? ["mock"],
      reason: "mock moderation provider",
      scores,
      providerReference: `mock:${context.photoId}`,
    };
  },
};

export function pickProvider(): ModerationProvider {
  if (process.env.MODERATION_PROVIDER?.trim().toLowerCase() === "mock") {
    return mockProvider;
  }
  // Ordered fallback chain (MODERATION_PROVIDERS="openai,google_vision,...").
  // Adapters missing their env are skipped inside the resolver; an empty
  // result falls through to the legacy single-provider selection.
  const chain = resolveConfiguredProviders(externalProvider);
  if (chain.length > 0) return buildModerationChain(chain);
  if (process.env.MODERATION_API_URL && process.env.MODERATION_API_KEY) {
    return externalProvider;
  }
  return nullProvider;
}

// ---------------------------------------------------------------------------
// Decision engine: scores -> severity -> action
// ---------------------------------------------------------------------------

export type PhotoSafetySeverity = "low" | "medium" | "high" | "critical";
export type PhotoSafetyAction = "approve" | "needs_review" | "hide" | "block";

export type PhotoSafetyDecision = {
  severity: PhotoSafetySeverity;
  action: PhotoSafetyAction;
  caseType: ModerationCaseType | null;
  /** Minors / near-certain explicit / synthetic identity - may auto-suspend. */
  policyCritical: boolean;
};

/** Deterministic thresholds - the whole matrix in one visible place. */
export const PHOTO_SAFETY_THRESHOLDS = {
  /** minorRiskScore at/above this = CRITICAL regardless of anything else. */
  minorCritical: 0.6,
  /** minors label + this much adult content = CRITICAL. */
  minorWithAdult: 0.4,
  /** adult/violence/stolen at/above this = HIGH (hide + case). */
  high: 0.85,
  /** near-certain explicit content counts as policy-critical. */
  explicitCritical: 0.97,
  /** any category at/above this = MEDIUM (approve + needs_review case). */
  medium: 0.6,
} as const;

/**
 * Map one provider verdict to a graduated decision:
 *   low      -> approve
 *   medium   -> approve, flag needs_review (+ case)
 *   high     -> hide the photo (+ case + graduated violation)
 *   critical -> block (photo rejected + account restricted + urgent case)
 * A provider's own "rejected"/"review" decision can only ESCALATE the
 * score-derived severity, never soften it.
 */
export function decidePhotoSafety(verdict: ModerationVerdict): PhotoSafetyDecision {
  const s = verdict.scores ?? NULL_SCORES;
  const labels = verdict.labels.map((l) => l.toLowerCase());
  const t = PHOTO_SAFETY_THRESHOLDS;
  const n = (v: number | null) => v ?? 0;

  // CRITICAL - minor safety first, always.
  if (
    n(s.minorRiskScore) >= t.minorCritical ||
    (labels.includes("minors") && n(s.adultScore) >= t.minorWithAdult)
  ) {
    return {
      severity: "critical",
      action: "block",
      caseType: "MINOR_SAFETY",
      policyCritical: true,
    };
  }
  if (n(s.adultScore) >= t.explicitCritical) {
    return {
      severity: "critical",
      action: "block",
      caseType: "EXPLICIT_CONTENT",
      policyCritical: true,
    };
  }

  // HIGH - hide + case (graduated enforcement decides the account action).
  if (n(s.adultScore) >= t.high) {
    return {
      severity: "high",
      action: "hide",
      caseType: "EXPLICIT_CONTENT",
      policyCritical: false,
    };
  }
  if (n(s.duplicateMatchScore) >= t.high || n(s.reverseImageRisk) >= t.high) {
    return { severity: "high", action: "hide", caseType: "STOLEN_IMAGES", policyCritical: false };
  }
  if (n(s.violenceScore) >= t.high || verdict.decision === "rejected") {
    return { severity: "high", action: "hide", caseType: "OTHER", policyCritical: false };
  }

  // MEDIUM - stays visible, needs a human look.
  if (n(s.adultScore) >= t.medium || n(s.violenceScore) >= t.medium) {
    return {
      severity: "medium",
      action: "needs_review",
      caseType: "EXPLICIT_CONTENT",
      policyCritical: false,
    };
  }
  if (n(s.duplicateMatchScore) >= t.medium || n(s.reverseImageRisk) >= t.medium) {
    return {
      severity: "medium",
      action: "needs_review",
      caseType: "STOLEN_IMAGES",
      policyCritical: false,
    };
  }
  if (n(s.aiGeneratedScore) >= t.medium) {
    return {
      severity: "medium",
      action: "needs_review",
      caseType: "IMPERSONATION",
      policyCritical: false,
    };
  }
  if (verdict.decision === "review") {
    return { severity: "medium", action: "needs_review", caseType: "OTHER", policyCritical: false };
  }

  return { severity: "low", action: "approve", caseType: null, policyCritical: false };
}

/** Decision-engine action -> (Photo.moderation, Photo.status, event action). */
const ACTION_STATE = {
  // Visible immediately.
  approve: { moderation: "APPROVED", status: "ACTIVE", action: "auto-approved" },
  // Visible while a human reviews it - the media proxy only blocks REJECTED.
  needs_review: { moderation: "PENDING", status: "ACTIVE", action: "flagged-for-review" },
  // Never public - canViewPhoto/the media proxy enforce this.
  hide: { moderation: "REJECTED", status: "REJECTED", action: "auto-rejected" },
  block: { moderation: "REJECTED", status: "REJECTED", action: "auto-rejected" },
} as const;

const RESULT_STATUS_FOR_ACTION: Record<PhotoSafetyAction, PhotoModerationResultStatus> = {
  approve: "APPROVED",
  needs_review: "NEEDS_REVIEW",
  hide: "REJECTED",
  block: "REJECTED",
};

const CASE_SEVERITY: Record<PhotoSafetySeverity, "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"> = {
  low: "LOW",
  medium: "MEDIUM",
  high: "HIGH",
  critical: "CRITICAL",
};

function verdictReason(verdict: ModerationVerdict): string {
  const labels = verdict.labels.length > 0 ? ` [labels: ${verdict.labels.join(", ")}]` : "";
  return `${verdict.reason ?? "no reason provided"}${labels}`;
}

/** Persist the PII-stripped provider output (scores + labels, no biometrics). */
async function persistModerationResult(
  photoId: string,
  providerName: string,
  resultStatus: PhotoModerationResultStatus,
  verdict: ModerationVerdict | null,
): Promise<void> {
  const s = verdict?.scores ?? NULL_SCORES;
  await db.photoModerationResult.create({
    data: {
      photoId,
      provider: providerName,
      resultStatus,
      detectedLabels: verdict?.labels ?? [],
      faceCount: verdict?.facesCount ?? null,
      adultScore: s.adultScore,
      violenceScore: s.violenceScore,
      minorRiskScore: s.minorRiskScore,
      aiGeneratedScore: s.aiGeneratedScore,
      duplicateMatchScore: s.duplicateMatchScore,
      reverseImageRisk: s.reverseImageRisk,
      confidence: s.confidence,
      rawProviderReference: verdict?.providerReference ?? null,
    },
  });
}

export type ModeratePhotoOutcome = {
  action: PhotoSafetyAction | "provider_failed";
  severity: PhotoSafetySeverity | null;
  caseId: string | null;
  violationId: string | null;
};

/**
 * Runs automated moderation for one photo and applies the graduated
 * decision:
 *   low      -> approved/visible
 *   medium   -> visible + PENDING + moderation case (human review)
 *   high     -> photo hidden (REJECTED) + case + graduated violation
 *   critical -> photo blocked + URGENT case + account restricted
 *               (suspend pending review at high confidence - never a ban)
 * Provider failures never throw (the upload must not fail because
 * moderation is down): the photo stays PENDING/ACTIVE = needs_review, a
 * FAILED PhotoModerationResult and a "moderation-error" event record what
 * happened. A failure NEVER auto-approves.
 */
export async function moderatePhoto(photoId: string): Promise<ModeratePhotoOutcome> {
  const photo = await db.photo.findUnique({
    where: { id: photoId },
    select: { id: true, userId: true, isCover: true, mimeType: true, storagePath: true },
  });
  if (!photo) {
    console.warn(`[moderation] photo ${photoId} vanished before moderation ran`);
    return { action: "provider_failed", severity: null, caseId: null, violationId: null };
  }

  const provider = pickProvider();
  const context: ModerationContext = {
    photoId: photo.id,
    userId: photo.userId,
    isCover: photo.isCover,
    mimeType: photo.mimeType,
  };

  let verdict: ModerationVerdict;
  try {
    let input: ModerationInput = {};
    if (provider !== nullProvider && provider !== mockProvider) {
      // The bucket is private, so a real provider (single or chain) gets
      // the bytes, not a URL.
      input = { buffer: await downloadCardVariant(photo.storagePath) };
    }
    verdict = await provider.analyze(input, context);
  } catch (error) {
    console.error(`[moderation] provider "${provider.name}" failed for photo ${photoId}`, error);
    await persistModerationResult(photo.id, provider.name, "FAILED", null);
    await db.photoModerationEvent.create({
      data: {
        photoId: photo.id,
        actorId: null,
        action: "moderation-error",
        reason: `provider "${provider.name}" failed: ${error instanceof Error ? error.message : "unknown error"}`,
      },
    });
    // Defaults = moderation PENDING, status ACTIVE: the needs-review queue,
    // never an approval.
    return { action: "provider_failed", severity: null, caseId: null, violationId: null };
  }

  if (provider === nullProvider) {
    // Honest by design: dev/unconfigured installs auto-approve, and both the
    // server log and the event history say so explicitly.
    console.warn(
      `[moderation] no provider configured - photo ${photoId} auto-approved as "unmoderated"`,
    );
  }

  const decision = decidePhotoSafety(verdict);
  const state = ACTION_STATE[decision.action];

  await persistModerationResult(
    photo.id,
    provider.name,
    RESULT_STATUS_FOR_ACTION[decision.action],
    verdict,
  );

  await db.$transaction(async (tx) => {
    await tx.photo.update({
      where: { id: photo.id },
      data: {
        moderation: state.moderation,
        status: state.status,
        aiScore: verdict.aiScore,
        faceDetected: verdict.faceDetected,
        facesCount: verdict.facesCount,
        // Automated decisions stamp the time but never a human reviewer.
        // "needs_review" is not a decision yet, so it leaves moderatedAt unset.
        moderatedAt: decision.action === "needs_review" ? null : new Date(),
        moderatedById: null,
      },
    });
    await tx.photoModerationEvent.create({
      data: {
        photoId: photo.id,
        actorId: null, // automated decision
        action: state.action,
        reason: verdictReason(verdict),
        aiScore: verdict.aiScore,
      },
    });
    // Cover rule: warn (never block) when the cover photo has no detected
    // face. Only fires on an explicit `false` - null means "not analyzed".
    if (photo.isCover && verdict.faceDetected === false) {
      await tx.photoModerationEvent.create({
        data: {
          photoId: photo.id,
          actorId: null,
          action: "cover-face-warning",
          reason: "cover photo has no detected face",
        },
      });
    }
  });

  // Case + graduated enforcement OUTSIDE the photo transaction: the photo
  // state must land even if case/violation writes hit a transient error.
  let caseId: string | null = null;
  let violationId: string | null = null;
  if (decision.caseType) {
    const opened = await openModerationCase({
      userId: photo.userId,
      caseType: decision.caseType,
      severity: CASE_SEVERITY[decision.severity],
      source: "AUTOMATED",
      confidence: verdict.scores?.confidence ?? null,
      summary:
        decision.action === "needs_review"
          ? `Automated moderation flagged photo ${photo.id} for human review.`
          : `Automated moderation ${decision.action === "block" ? "blocked" : "hid"} photo ${photo.id}.`,
      evidence: {
        photoId: photo.id,
        provider: provider.name,
        labels: verdict.labels,
        scores: verdict.scores ?? NULL_SCORES,
      },
      photoId: photo.id,
    });
    caseId = opened.caseId;

    if (decision.action === "hide" || decision.action === "block") {
      const enforcement = await enforceGraduated({
        userId: photo.userId,
        violationType: decision.caseType,
        policyCritical: decision.policyCritical,
        confidence: verdict.scores?.confidence ?? null,
        photoId: photo.id,
        moderationCaseId: caseId,
        internalReason:
          `automated photo moderation: ${decision.severity} severity ` +
          `(${verdict.labels.join(", ") || "no labels"})`,
      });
      violationId = enforcement.violationId;
    }
  }

  return { action: decision.action, severity: decision.severity, caseId, violationId };
}

/** Fetches the card-variant bytes from the private bucket for the provider. */
async function downloadCardVariant(storagePath: string | null): Promise<Buffer> {
  if (!storagePath) throw new Error("photo has no storagePath");
  const supabase = await storageClient();
  const { data, error } = await supabase.storage
    .from(PHOTOS_BUCKET)
    .download(`${storagePath}/card.webp`);
  if (error || !data) {
    throw new Error(`could not download card variant: ${error?.message ?? "no data"}`);
  }
  return Buffer.from(await data.arrayBuffer());
}
