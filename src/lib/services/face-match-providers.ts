import { createHash } from "node:crypto";
import { faceMatchLegalGate } from "@/lib/services/face-rollout";

/**
 * FaceComparisonProvider - the vendor seam for PROFILE-PHOTO verification
 * (the second, internal layer of photo verification; see
 * docs/FACE-VERIFICATION.md).
 *
 * Stripe Identity answers "is this a real person holding their own
 * document?". This seam answers "does the Tirvea gallery belong to that
 * verified person?" - a question Stripe does not address.
 *
 * PRIVACY CONTRACT (mirrors photo-verification.ts): Tirvea never stores
 * embeddings, templates or any biometric derivative. A provider hands
 * back an OPAQUE referenceId (its own handle); deleteReference destroys
 * the biometric material at the vendor. Scores/classifications derived
 * from comparisons are not biometric data and are stored for policy and
 * calibration.
 *
 * Follows the moderation-providers.ts adapter pattern: named adapters,
 * env-driven resolution, honest not-configured behavior (the WHOLE
 * profile-photo layer stays dormant when unset - the public badge then
 * derives from identity verification alone, exactly the pre-existing
 * behavior).
 */

export type FaceDetectInput = {
  /** Card-size variant bytes (the canonical 4:5 image). */
  image: Buffer;
  /** Stable identity of the exact stored version being analysed. */
  photoId: string;
  photoVersion: number;
};

export type FaceDetection = {
  faceCount: number;
  /** Largest face's share of image area, 0..1 (dominance heuristic). */
  dominantFaceRatio: number | null;
  /** 0..1 - blur/exposure/size quality of the best face. */
  qualityScore: number | null;
};

export type FaceReferenceInput = {
  userId: string;
  /** Provider-side handle for the identity selfie when available
   *  (e.g. a Stripe FileLink fetched server-side with a restricted key).
   *  The mock provider derives a deterministic reference from userId. */
  selfieImage?: Buffer;
  identitySessionId?: string | null;
};

export type FaceComparison = {
  /** Raw similarity 0..1 as calibrated by THIS provider (never shown to
   *  users; bands are derived by policy thresholds per provider). */
  similarity: number | null;
  ownerDetected: boolean;
  faceCount: number;
  dominantFaceRatio: number | null;
  qualityScore: number | null;
};

export type ManipulationAssessment = {
  /** 0..1 - likelihood of AI generation / heavy manipulation / screenshot. */
  risk: number | null;
};

export interface FaceComparisonProvider {
  readonly name: string;
  /** Vendor model/version the references are built with - persisted on
   *  the job row so a provider upgrade can trigger rotation. */
  readonly modelVersion?: string;
  /** Processing region (EU pinning evidence for the DPIA). */
  readonly region?: string;
  detectFaces(input: FaceDetectInput): Promise<FaceDetection>;
  /** Create (or replace) the user's reference from the verified identity
   *  selfie. Returns the provider's opaque handle. */
  createReference(input: FaceReferenceInput): Promise<{ referenceId: string }>;
  compareReferenceToPhoto(referenceId: string, input: FaceDetectInput): Promise<FaceComparison>;
  assessManipulationRisk(input: FaceDetectInput): Promise<ManipulationAssessment>;
  /** Destroy the biometric material at the vendor (GDPR deletion path). */
  deleteReference(referenceId: string): Promise<void>;
  /** Optional duplicate-likeness search: other references resembling this
   *  one, as opaque ids + coarse bands. Never raw scores. */
  searchLikeness?(
    referenceId: string,
  ): Promise<Array<{ referenceId: string; band: "confident" | "uncertain" }>>;
  /** Liveness capture (Phase 23): create a hosted/SDK session. */
  createLivenessSession?(userId: string): Promise<{ sessionId: string }>;
  /** Liveness result: normalized outcome + whether a trusted reference
   *  frame is available. NEVER returns media, scores or vendor payloads.
   *  `providerStatus` is the raw non-PII vendor status string (e.g. AWS
   *  "CREATED"/"IN_PROGRESS"/"SUCCEEDED") for diagnostics only. */
  getLivenessResult?(sessionId: string): Promise<{
    status: "pending" | "passed" | "failed";
    referenceFrameReady: boolean;
    providerStatus?: string;
  }>;
  /** Create the reference FROM a passed liveness session (Phase 24: the
   *  ONLY trusted reference source - never an unverified profile photo). */
  createReferenceFromLiveness?(input: {
    userId: string;
    livenessSessionId: string;
    /** Deterministic ExternalImageId from the registry saga (H-1). */
    externalImageId: string;
  }): Promise<{ referenceId: string }>;
  /** Emergency purge: destroy the whole collection (admin path only). */
  purgeAllReferences?(): Promise<void>;
}

export class FaceMatchNotConfiguredError extends Error {
  readonly code = "face_match_not_configured";
  constructor(message = "Face comparison is not configured.") {
    super(message);
    this.name = "FaceMatchNotConfiguredError";
  }
}

/** Honest default: every operation refuses; callers treat the layer as OFF. */
export const faceMatchNotConfiguredProvider: FaceComparisonProvider = {
  name: "none",
  async detectFaces() {
    throw new FaceMatchNotConfiguredError();
  },
  async createReference() {
    throw new FaceMatchNotConfiguredError();
  },
  async compareReferenceToPhoto() {
    throw new FaceMatchNotConfiguredError();
  },
  async assessManipulationRisk() {
    throw new FaceMatchNotConfiguredError();
  },
  async deleteReference() {
    throw new FaceMatchNotConfiguredError();
  },
};

// ---------------------------------------------------------------------------
// Mock provider (dev/tests) - deterministic, zero biometrics, NEVER prod.
//
// Behavior is driven by markers embedded in the image bytes so tests can
// stage every classification: the FIRST of these tokens found in the
// buffer wins (uploads in tests are tiny synthetic images with the token
// appended to the buffer; real images simply never contain them).
//   face:none        -> no face
//   face:owner       -> single owner face, confident match
//   face:group       -> 3 faces, owner among them
//   face:other       -> single face, confident NON-match
//   face:uncertain   -> single face, low-confidence match
//   face:manipulated -> manipulation risk 0.95
// Default (no token): single owner face, confident match.
// ---------------------------------------------------------------------------

function marker(image: Buffer): string {
  const text = image.toString("latin1");
  const m = /face:(none|owner|group|other|uncertain|manipulated)/.exec(text);
  return m?.[1] ?? "owner";
}

/** Mock liveness state (dev/tests only - no media anywhere). */
const mockLivenessStatus = new Map<string, "pending" | "passed" | "failed">();
let mockLivenessSeq = 0;
export function setMockLivenessStatus(
  sessionId: string,
  status: "pending" | "passed" | "failed",
): void {
  mockLivenessStatus.set(sessionId, status);
}

/** Test seam: stage likeness matches for the mock provider. */
const mockLikeness = new Map<
  string,
  Array<{ referenceId: string; band: "confident" | "uncertain" }>
>();
export function setMockLikenessMatches(
  referenceId: string,
  matches: Array<{ referenceId: string; band: "confident" | "uncertain" }> | null,
): void {
  if (matches === null) mockLikeness.delete(referenceId);
  else mockLikeness.set(referenceId, matches);
}

export const mockFaceMatchProvider: FaceComparisonProvider = {
  name: "mock",
  modelVersion: "mock-1",
  region: "eu-west-1",
  async detectFaces({ image }) {
    const kind = marker(image);
    if (kind === "none") return { faceCount: 0, dominantFaceRatio: null, qualityScore: 0.9 };
    if (kind === "group") return { faceCount: 3, dominantFaceRatio: 0.35, qualityScore: 0.85 };
    if (kind === "uncertain") return { faceCount: 1, dominantFaceRatio: 0.4, qualityScore: 0.35 };
    return { faceCount: 1, dominantFaceRatio: 0.6, qualityScore: 0.9 };
  },
  async createReference({ userId }) {
    // Deterministic opaque handle - NOT biometric data (a hash of the id).
    return {
      referenceId: `mockref_${createHash("sha256").update(userId).digest("hex").slice(0, 16)}`,
    };
  },
  async compareReferenceToPhoto(_referenceId, { image }) {
    const kind = marker(image);
    switch (kind) {
      case "none":
        return {
          similarity: null,
          ownerDetected: false,
          faceCount: 0,
          dominantFaceRatio: null,
          qualityScore: 0.9,
        };
      case "group":
        return {
          similarity: 0.93,
          ownerDetected: true,
          faceCount: 3,
          dominantFaceRatio: 0.35,
          qualityScore: 0.85,
        };
      case "other":
        return {
          similarity: 0.12,
          ownerDetected: false,
          faceCount: 1,
          dominantFaceRatio: 0.6,
          qualityScore: 0.9,
        };
      case "uncertain":
        return {
          similarity: 0.62,
          ownerDetected: false,
          faceCount: 1,
          dominantFaceRatio: 0.4,
          qualityScore: 0.35,
        };
      case "manipulated":
        return {
          similarity: 0.9,
          ownerDetected: true,
          faceCount: 1,
          dominantFaceRatio: 0.6,
          qualityScore: 0.9,
        };
      default:
        return {
          similarity: 0.97,
          ownerDetected: true,
          faceCount: 1,
          dominantFaceRatio: 0.6,
          qualityScore: 0.9,
        };
    }
  },
  async assessManipulationRisk({ image }) {
    return { risk: marker(image) === "manipulated" ? 0.95 : 0.02 };
  },
  async deleteReference() {
    // Nothing stored anywhere - deterministic hash, no state.
  },
  async searchLikeness(referenceId: string) {
    return mockLikeness.get(referenceId) ?? [];
  },
  async createLivenessSession(userId: string) {
    const id = `mocklive_${createHash("sha256").update(`${userId}:${mockLivenessSeq++}`).digest("hex").slice(0, 12)}`;
    mockLivenessStatus.set(id, "passed");
    return { sessionId: id };
  },
  async getLivenessResult(sessionId: string) {
    const status = mockLivenessStatus.get(sessionId) ?? "pending";
    return { status, referenceFrameReady: status === "passed" };
  },
  async createReferenceFromLiveness({ livenessSessionId, externalImageId }) {
    if (mockLivenessStatus.get(livenessSessionId) !== "passed") {
      throw new Error("liveness session not passed");
    }
    // Deterministic FaceId derived from the registry key (unique per
    // env/user/version) - mirrors AWS returning a distinct FaceId.
    return {
      referenceId: `mockface_${createHash("sha256").update(externalImageId).digest("hex").slice(0, 16)}`,
    };
  },
  async purgeAllReferences() {
    mockLikeness.clear();
    mockLivenessStatus.clear();
  },
};

// ---------------------------------------------------------------------------
// AWS Rekognition (documented stub - same stance as moderation-providers'
// aws_rekognition): CompareFaces + DetectFaces + (liveness via the
// moderation layer's aiGeneratedScore). Envs when it ships:
// AWS_REKOGNITION_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.
// Reference storage = Rekognition Collections (IndexFaces -> FaceId as
// referenceId; DeleteFaces on deleteReference). Needs SigV4 signing.
// ---------------------------------------------------------------------------

// Real adapter lives in aws-rekognition.ts (SigV4, no SDK). Imported
// lazily at resolution time so the crypto/signing code never loads in
// deployments that don't use it.
let awsProviderCache: FaceComparisonProvider | null = null;
function loadAwsProvider(): FaceComparisonProvider {
  if (!awsProviderCache) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@/lib/services/aws-rekognition") as {
      awsRekognitionProvider: FaceComparisonProvider;
    };
    awsProviderCache = mod.awsRekognitionProvider;
  }
  return awsProviderCache;
}

/**
 * Env-driven resolution, mirroring getPhotoVerificationProvider():
 *   FACE_MATCH_PROVIDER = "" (off - the default) | "mock" | "aws_rekognition_faces"
 * Mock is dev/tests tooling - never silently active in production.
 */
export function getFaceMatchProvider(): FaceComparisonProvider {
  const which = process.env.FACE_MATCH_PROVIDER?.trim().toLowerCase();
  if (which === "mock" && process.env.NODE_ENV !== "production") return mockFaceMatchProvider;
  if (which === "aws_rekognition_faces") {
    // HARD LEGAL GATE (Phase 32 / H4): production biometric processing requires
    // the FULL recorded compliance set - counsel-approved version (present AND
    // allow-listed), executed DPA, approved calibration + version, and the
    // emergency switch OFF - not merely a non-empty version string. The runtime
    // fails closed here, independently of the rehearsal preflight, so the layer
    // can never enable itself without every approval on record.
    if (process.env.NODE_ENV === "production" && !faceMatchLegalGate().ok) {
      return faceMatchNotConfiguredProvider;
    }
    return loadAwsProvider();
  }
  return faceMatchNotConfiguredProvider;
}

export function isFaceMatchConfigured(): boolean {
  return getFaceMatchProvider() !== faceMatchNotConfiguredProvider;
}

/**
 * Provider config/state alert evaluation (Phase 7). Env + adapter state
 * only - never queries metrics, never touches PII. Lives in the adapter
 * layer so consumers (verification-metrics) stay provider-agnostic: they
 * just fire whatever normalized kinds we return and resolve the rest.
 *
 * Returns `fire` (rules currently tripped) and `resolve` (rules that are
 * healthy right now, so any prior alert of that kind can be cleared).
 */
export async function evaluateProviderConfigAlerts(): Promise<{
  fire: Array<{ kind: string; detail: string }>;
  resolve: string[];
}> {
  const fire: Array<{ kind: string; detail: string }> = [];
  const resolve: string[] = [];
  const which = process.env.FACE_MATCH_PROVIDER?.trim().toLowerCase();

  if (process.env.FACE_EMERGENCY_DISABLE === "1") {
    fire.push({
      kind: "emergency_disable_active",
      detail: "FACE_EMERGENCY_DISABLE is ON - face admission is blocked.",
    });
  }

  if (which === "aws_rekognition_faces") {
    if (process.env.NODE_ENV === "production" && !process.env.FACE_LEGAL_APPROVAL_VERSION?.trim()) {
      fire.push({
        kind: "legal_gate_missing",
        detail: "Face provider selected in production without a recorded legal approval version.",
      });
    }
    // Region consistency is an adapter concern - keep the vendor call here.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const adapter = require("@/lib/services/aws-rekognition") as {
      awsRekognitionConfigured: () => boolean;
      assertRegionConsistency: () => void;
    };
    if (adapter.awsRekognitionConfigured()) {
      try {
        adapter.assertRegionConsistency();
        resolve.push("region_mismatch");
      } catch (e) {
        fire.push({
          kind: "region_mismatch",
          detail: e instanceof Error ? e.message : "region consistency check failed",
        });
      }
    }
  }

  return { fire, resolve };
}
