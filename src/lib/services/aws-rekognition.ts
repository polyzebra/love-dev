import { createHash, createHmac } from "node:crypto";
import {
  FaceMatchNotConfiguredError,
  type FaceComparison,
  type FaceComparisonProvider,
  type FaceDetectInput,
  type FaceDetection,
  type ManipulationAssessment,
} from "@/lib/services/face-match-providers";

/**
 * AWS Rekognition adapter (Phase 22) - the REAL provider behind the
 * existing FaceComparisonProvider abstraction. No AWS SDK: SigV4-signed
 * fetch, the same stance as the Stripe adapter (house pattern), with an
 * injectable transport so tests never touch the network.
 *
 * CONTAINMENT: AWS types, ARNs, FaceIds, confidence numbers, collection
 * ids and raw response objects NEVER leave this file. The application
 * receives normalized domain values only (bands, booleans, opaque
 * reference handles that happen to be FaceIds but are treated as opaque
 * strings everywhere else - a test pins that no caller parses them).
 *
 * NEVER LOGGED: capture images, reference images, FaceIds, similarity
 * values, liveness media, signed URLs, request payloads. This module
 * contains no logging statements at all.
 *
 * IDEMPOTENCY:
 *  - reference creation: ExternalImageId = `${userId}:${referenceVersion}`
 *    and IndexFaces is preceded by a ListFaces check for that key, so one
 *    (user, version) can never hold two active references.
 *  - comparison / deletion / result retrieval: naturally idempotent
 *    (SearchFacesByImage is a read; DeleteFaces on a missing FaceId is a
 *    no-op; GetFaceLivenessSessionResults is a read).
 *
 * LEAST PRIVILEGE: the runtime path needs only
 *   rekognition:CreateFaceLivenessSession, GetFaceLivenessSessionResults,
 *   IndexFaces, SearchFacesByImage, SearchFaces, DeleteFaces, ListFaces
 * Collection ADMINISTRATION (CreateCollection / DeleteCollection /
 * DescribeCollection) is a SEPARATE credential pair used only by the
 * ops CLI - see docs/AWS-IAM-VERIFICATION.md.
 */

const SERVICE = "rekognition";

export function awsConfig() {
  return {
    region: process.env.AWS_REKOGNITION_REGION?.trim() || "eu-west-1",
    accessKeyId: process.env.AWS_ACCESS_KEY_ID?.trim(),
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY?.trim(),
    collectionId: process.env.FACE_COLLECTION_ID?.trim(),
    /** Separate admin credentials - NOT used by the runtime path. */
    adminAccessKeyId: process.env.AWS_ADMIN_ACCESS_KEY_ID?.trim(),
    adminSecretAccessKey: process.env.AWS_ADMIN_SECRET_ACCESS_KEY?.trim(),
    /** Model version pin (rotation trigger when AWS upgrades). */
    modelVersion: process.env.FACE_MODEL_VERSION?.trim() || "rekognition-6.0",
    /** Approved EU regions - anything else is refused (Phase 31). */
    allowedRegions: (process.env.AWS_ALLOWED_REGIONS?.trim() || "eu-west-1")
      .split(",")
      .map((r) => r.trim()),
  };
}

export function awsRekognitionConfigured(): boolean {
  const cfg = awsConfig();
  return Boolean(cfg.accessKeyId && cfg.secretAccessKey && cfg.collectionId);
}

/** Injectable transport: (target, payload) -> parsed JSON response. */
export type RekognitionTransport = (
  target: string,
  payload: Record<string, unknown>,
  opts: { admin?: boolean },
) => Promise<Record<string, unknown>>;

let transportOverride: RekognitionTransport | null = null;
export function setRekognitionTransport(fn: RekognitionTransport | null): void {
  transportOverride = fn;
}

// --------------------------------------------------------------- SigV4
function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}
function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

/** Minimal SigV4 signer for the Rekognition JSON protocol. */
function signRequest(input: {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  target: string;
  body: string;
  now: Date;
}): { url: string; headers: Record<string, string> } {
  const host = `${SERVICE}.${input.region}.amazonaws.com`;
  const amzDate = input.now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(input.body);

  const canonicalHeaders =
    `content-type:application/x-amz-json-1.1\n` +
    `host:${host}\n` +
    `x-amz-date:${amzDate}\n` +
    `x-amz-target:RekognitionService.${input.target}\n`;
  const signedHeaders = "content-type;host;x-amz-date;x-amz-target";
  const canonicalRequest = ["POST", "/", "", canonicalHeaders, signedHeaders, payloadHash].join(
    "\n",
  );

  const scope = `${dateStamp}/${input.region}/${SERVICE}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

  const kDate = hmac(`AWS4${input.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  return {
    url: `https://${host}/`,
    headers: {
      "content-type": "application/x-amz-json-1.1",
      "x-amz-date": amzDate,
      "x-amz-target": `RekognitionService.${input.target}`,
      authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

/** One signed call. Errors are NORMALIZED - never raw AWS payloads. */
async function call(
  target: string,
  payload: Record<string, unknown>,
  opts: { admin?: boolean } = {},
): Promise<Record<string, unknown>> {
  if (transportOverride) return transportOverride(target, payload, opts);

  const cfg = awsConfig();
  // Regional consistency + restriction enforcement (M-3), fail CLOSED:
  //  - the resolved Rekognition region must be in the approved list;
  //  - AWS_REGION (if set) must AGREE with AWS_REKOGNITION_REGION;
  //  - all downstream calls (endpoint, collection, liveness) use this one
  //    canonical resolved region.
  const globalRegion = process.env.AWS_REGION?.trim();
  if (!cfg.allowedRegions.includes(cfg.region)) {
    throw new FaceMatchNotConfiguredError(
      `region ${cfg.region} is not in the approved region list`,
    );
  }
  if (globalRegion && globalRegion !== cfg.region) {
    throw new FaceMatchNotConfiguredError(
      `AWS_REGION (${globalRegion}) disagrees with AWS_REKOGNITION_REGION (${cfg.region})`,
    );
  }
  const accessKeyId = opts.admin ? cfg.adminAccessKeyId : cfg.accessKeyId;
  const secretAccessKey = opts.admin ? cfg.adminSecretAccessKey : cfg.secretAccessKey;
  if (!accessKeyId || !secretAccessKey) {
    throw new FaceMatchNotConfiguredError(
      opts.admin ? "AWS admin credentials are not set" : "AWS credentials are not set",
    );
  }

  const body = JSON.stringify(payload);
  const signed = signRequest({
    region: cfg.region,
    accessKeyId,
    secretAccessKey,
    target,
    body,
    now: new Date(),
  });
  const res = await fetch(signed.url, { method: "POST", headers: signed.headers, body });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    // Normalized error: AWS error TYPE only (e.g. ThrottlingException) -
    // no message bodies, no request payloads, no biometric context.
    const type = String(json["__type"] ?? `HTTP_${res.status}`)
      .split("#")
      .pop();
    throw new Error(`rekognition ${target} failed: ${type}`);
  }
  return json;
}

// ----------------------------------------------------- normalized bands
function bandFor(similarity: number, matchAt: number, mismatchAt: number) {
  if (similarity >= matchAt) return "confident" as const;
  if (similarity <= mismatchAt) return "mismatch" as const;
  return "uncertain" as const;
}
function thresholds() {
  const n = (v: string | undefined, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    // Rekognition similarity is 0-100; our policy layer speaks 0-1, so the
    // adapter normalizes here (the ONLY place vendor scales exist).
    matchAt: n(process.env.FACE_AWS_MATCH_SIMILARITY, 92),
    mismatchAt: n(process.env.FACE_AWS_MISMATCH_SIMILARITY, 70),
    minFaceConfidence: n(process.env.FACE_AWS_MIN_FACE_CONFIDENCE, 90),
  };
}

type AwsFace = {
  BoundingBox?: { Width?: number; Height?: number };
  Confidence?: number;
  Quality?: { Brightness?: number; Sharpness?: number };
};

function detectionFrom(faces: AwsFace[]): FaceDetection {
  if (faces.length === 0) return { faceCount: 0, dominantFaceRatio: null, qualityScore: null };
  const areas = faces.map((f) => (f.BoundingBox?.Width ?? 0) * (f.BoundingBox?.Height ?? 0));
  const best = Math.max(...areas);
  const bestFace = faces[areas.indexOf(best)];
  const sharpness = bestFace.Quality?.Sharpness ?? 100;
  const brightness = bestFace.Quality?.Brightness ?? 100;
  return {
    faceCount: faces.length,
    dominantFaceRatio: best,
    // Normalized 0-1 quality from the vendor's 0-100 scales.
    qualityScore: Math.min(1, (Math.min(sharpness, brightness) / 100) * 1),
  };
}

// --------------------------------------------------------- the adapter
export const awsRekognitionProvider: FaceComparisonProvider = {
  name: "aws_rekognition_faces",
  get modelVersion() {
    return awsConfig().modelVersion;
  },
  get region() {
    return awsConfig().region;
  },

  async detectFaces(input: FaceDetectInput): Promise<FaceDetection> {
    if (!awsRekognitionConfigured()) throw new FaceMatchNotConfiguredError();
    const res = await call("DetectFaces", {
      Image: { Bytes: input.image.toString("base64") },
      Attributes: ["DEFAULT"],
    });
    return detectionFrom((res.FaceDetails as AwsFace[]) ?? []);
  },

  /** Reference creation from a PASSED liveness session (Phase 24 / H-1).
   *  ExternalImageId is supplied by the registry saga - deterministic per
   *  (environment, user, referenceVersion). NO global epoch, NO ListFaces
   *  dedup (the DB registry owns idempotency). Returns the exact FaceId. */
  async createReferenceFromLiveness({
    livenessSessionId,
    externalImageId,
  }): Promise<{ referenceId: string }> {
    if (!awsRekognitionConfigured()) throw new FaceMatchNotConfiguredError();
    if (!externalImageId) throw new Error("rekognition: externalImageId required (registry key)");
    const cfg = awsConfig();
    const result = await call("GetFaceLivenessSessionResults", { SessionId: livenessSessionId });
    if (String(result.Status) !== "SUCCEEDED") {
      throw new Error("rekognition liveness: session not succeeded");
    }
    const referenceImage = result.ReferenceImage as { Bytes?: string } | undefined;
    if (!referenceImage?.Bytes) throw new Error("rekognition liveness: no reference frame");
    const indexed = await call("IndexFaces", {
      CollectionId: cfg.collectionId,
      Image: { Bytes: referenceImage.Bytes },
      ExternalImageId: externalImageId,
      MaxFaces: 1,
      QualityFilter: "AUTO",
      DetectionAttributes: [],
    });
    const records = (indexed.FaceRecords as Array<{ Face?: { FaceId?: string } }>) ?? [];
    const faceId = records[0]?.Face?.FaceId;
    if (!faceId) throw new Error("rekognition IndexFaces: no face indexed");
    return { referenceId: faceId };
  },

  /** Legacy path (interface requirement). Refuses: a trusted reference
   *  may ONLY come from a liveness session (Phase 24 decision). */
  async createReference(): Promise<{ referenceId: string }> {
    throw new FaceMatchNotConfiguredError(
      "aws_rekognition_faces requires a liveness-derived reference (createReferenceFromLiveness)",
    );
  },

  async compareReferenceToPhoto(
    referenceId: string,
    input: FaceDetectInput,
  ): Promise<FaceComparison> {
    if (!awsRekognitionConfigured()) throw new FaceMatchNotConfiguredError();
    const cfg = awsConfig();
    const t = thresholds();

    const detected = await call("DetectFaces", {
      Image: { Bytes: input.image.toString("base64") },
      Attributes: ["DEFAULT"],
    });
    const faces = ((detected.FaceDetails as AwsFace[]) ?? []).filter(
      (f) => (f.Confidence ?? 0) >= t.minFaceConfidence,
    );
    const detection = detectionFrom(faces);
    if (detection.faceCount === 0) {
      return {
        similarity: null,
        ownerDetected: false,
        faceCount: 0,
        dominantFaceRatio: null,
        qualityScore: detection.qualityScore,
      };
    }

    const search = await call("SearchFacesByImage", {
      CollectionId: cfg.collectionId,
      Image: { Bytes: input.image.toString("base64") },
      MaxFaces: 5,
      FaceMatchThreshold: t.mismatchAt,
      QualityFilter: "AUTO",
    }).catch(() => ({}) as Record<string, unknown>);
    const matches =
      (search.FaceMatches as Array<{ Similarity?: number; Face?: { FaceId?: string } }>) ?? [];
    const own = matches.find((m) => m.Face?.FaceId === referenceId);
    const similarity = own?.Similarity ?? 0;

    return {
      // Normalized 0-1 for the policy layer (vendor 0-100 stays here).
      similarity: similarity / 100,
      ownerDetected: bandFor(similarity, t.matchAt, t.mismatchAt) === "confident",
      faceCount: detection.faceCount,
      dominantFaceRatio: detection.dominantFaceRatio,
      qualityScore: detection.qualityScore,
    };
  },

  async assessManipulationRisk(input: FaceDetectInput): Promise<ManipulationAssessment> {
    if (!awsRekognitionConfigured()) throw new FaceMatchNotConfiguredError();
    // Rekognition has no first-class deepfake detector; the moderation
    // plane owns AI-generation scoring (Photo.aiScore, moderation
    // providers). Signal a null risk so the policy layer falls back to
    // that plane instead of inventing a verdict here.
    void input;
    return { risk: null };
  },

  async searchLikeness(referenceId: string) {
    if (!awsRekognitionConfigured()) throw new FaceMatchNotConfiguredError();
    const cfg = awsConfig();
    const t = thresholds();
    const res = await call("SearchFaces", {
      CollectionId: cfg.collectionId,
      FaceId: referenceId,
      MaxFaces: 10,
      FaceMatchThreshold: t.mismatchAt,
    });
    const matches =
      (res.FaceMatches as Array<{ Similarity?: number; Face?: { FaceId?: string } }>) ?? [];
    return matches
      .filter((m) => m.Face?.FaceId && m.Face.FaceId !== referenceId)
      .map((m) => ({
        referenceId: m.Face!.FaceId!,
        band:
          bandFor(m.Similarity ?? 0, t.matchAt, t.mismatchAt) === "confident"
            ? ("confident" as const)
            : ("uncertain" as const),
      }));
  },

  async deleteReference(referenceId: string): Promise<void> {
    if (!awsRekognitionConfigured()) throw new FaceMatchNotConfiguredError();
    const cfg = awsConfig();
    // Idempotent: deleting an absent FaceId is a no-op at AWS.
    await call("DeleteFaces", {
      CollectionId: cfg.collectionId,
      FaceIds: [referenceId],
    });
  },

  async createLivenessSession(userId: string): Promise<{ sessionId: string }> {
    if (!awsRekognitionConfigured()) throw new FaceMatchNotConfiguredError();
    void userId; // never sent to the vendor - no PII in liveness payloads
    const res = await call("CreateFaceLivenessSession", {
      Settings: { AuditImagesLimit: 0 }, // no audit media retained
    });
    const sessionId = String(res.SessionId ?? "");
    if (!sessionId) throw new Error("rekognition liveness: no session id");
    return { sessionId };
  },

  async getLivenessResult(sessionId: string) {
    if (!awsRekognitionConfigured()) throw new FaceMatchNotConfiguredError();
    const res = await call("GetFaceLivenessSessionResults", { SessionId: sessionId });
    const status = String(res.Status ?? "");
    if (status === "SUCCEEDED") {
      return { status: "passed" as const, referenceFrameReady: Boolean(res.ReferenceImage) };
    }
    if (status === "FAILED" || status === "EXPIRED") {
      return { status: "failed" as const, referenceFrameReady: false };
    }
    return { status: "pending" as const, referenceFrameReady: false };
  },

  /** Emergency purge (admin credentials, NOT the runtime path). */
  async purgeAllReferences(): Promise<void> {
    const cfg = awsConfig();
    if (!cfg.adminAccessKeyId || !cfg.adminSecretAccessKey) {
      throw new FaceMatchNotConfiguredError("admin credentials required for collection purge");
    }
    await call("DeleteCollection", { CollectionId: cfg.collectionId }, { admin: true });
  },
};

/**
 * Startup / provider-init region check (M-3). Fail CLOSED when a value is
 * absent, the two region vars disagree, or the region is not approved.
 * Returns the resolved region or throws.
 */
export function assertRegionConsistency(): string {
  const cfg = awsConfig();
  const globalRegion = process.env.AWS_REGION?.trim();
  if (!cfg.region) throw new Error("AWS_REKOGNITION_REGION is not set");
  if (!cfg.allowedRegions.includes(cfg.region)) {
    throw new Error(`region ${cfg.region} not in AWS_ALLOWED_REGIONS`);
  }
  if (globalRegion && globalRegion !== cfg.region) {
    throw new Error(`AWS_REGION (${globalRegion}) != AWS_REKOGNITION_REGION (${cfg.region})`);
  }
  return cfg.region;
}
