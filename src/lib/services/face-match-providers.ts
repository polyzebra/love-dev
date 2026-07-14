import { createHash } from "node:crypto";

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
  detectFaces(input: FaceDetectInput): Promise<FaceDetection>;
  /** Create (or replace) the user's reference from the verified identity
   *  selfie. Returns the provider's opaque handle. */
  createReference(input: FaceReferenceInput): Promise<{ referenceId: string }>;
  compareReferenceToPhoto(referenceId: string, input: FaceDetectInput): Promise<FaceComparison>;
  assessManipulationRisk(input: FaceDetectInput): Promise<ManipulationAssessment>;
  /** Destroy the biometric material at the vendor (GDPR deletion path). */
  deleteReference(referenceId: string): Promise<void>;
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

export const mockFaceMatchProvider: FaceComparisonProvider = {
  name: "mock",
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
};

// ---------------------------------------------------------------------------
// AWS Rekognition (documented stub - same stance as moderation-providers'
// aws_rekognition): CompareFaces + DetectFaces + (liveness via the
// moderation layer's aiGeneratedScore). Envs when it ships:
// AWS_REKOGNITION_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.
// Reference storage = Rekognition Collections (IndexFaces -> FaceId as
// referenceId; DeleteFaces on deleteReference). Needs SigV4 signing.
// ---------------------------------------------------------------------------

export const awsRekognitionFaceProvider: FaceComparisonProvider = {
  name: "aws_rekognition_faces",
  async detectFaces() {
    throw new FaceMatchNotConfiguredError(
      "aws_rekognition_faces is a documented stub (SigV4 signing + Collections wiring pending).",
    );
  },
  async createReference() {
    throw new FaceMatchNotConfiguredError("aws_rekognition_faces stub");
  },
  async compareReferenceToPhoto() {
    throw new FaceMatchNotConfiguredError("aws_rekognition_faces stub");
  },
  async assessManipulationRisk() {
    throw new FaceMatchNotConfiguredError("aws_rekognition_faces stub");
  },
  async deleteReference() {
    throw new FaceMatchNotConfiguredError("aws_rekognition_faces stub");
  },
};

/**
 * Env-driven resolution, mirroring getPhotoVerificationProvider():
 *   FACE_MATCH_PROVIDER = "" (off - the default) | "mock" | "aws_rekognition_faces"
 * Mock is dev/tests tooling - never silently active in production.
 */
export function getFaceMatchProvider(): FaceComparisonProvider {
  const which = process.env.FACE_MATCH_PROVIDER?.trim().toLowerCase();
  if (which === "mock" && process.env.NODE_ENV !== "production") return mockFaceMatchProvider;
  if (which === "aws_rekognition_faces") return awsRekognitionFaceProvider;
  return faceMatchNotConfiguredProvider;
}

export function isFaceMatchConfigured(): boolean {
  return getFaceMatchProvider() !== faceMatchNotConfiguredProvider;
}
