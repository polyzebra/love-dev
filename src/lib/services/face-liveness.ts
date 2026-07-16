import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { getFaceMatchProvider } from "@/lib/services/face-match-providers";
import { faceEnvironment, faceEmergencyDisabled } from "@/lib/services/face-rollout";
import {
  enqueueProfilePhotoVerification,
  recordVerificationAudit,
  BIOMETRIC_CONSENT_VERSION,
} from "@/lib/services/face-verification";
import { enrollReferenceSaga } from "@/lib/services/face-reference-registry";

/**
 * Liveness session ownership binding (C-1) + reference enrollment (C-2).
 *
 * A provider liveness session is PERSISTED (LivenessSession) and bound to
 * (userId, verificationId, environment) BEFORE any id reaches the client.
 * The client only ever sees an opaque `flowId`; the provider sessionId
 * never leaves the server. Authorization is by DB binding
 * (flowId + userId + environment + non-expired + non-consumed/invalidated)
 * - never UUID secrecy, audit text, or "the user created some session".
 */

const SESSION_TTL_MS = (Number(process.env.FACE_LIVENESS_TTL_MINUTES) || 15) * 60_000;

/** Create + persist a bound liveness session; return the opaque flowId. */
export async function createBoundLivenessSession(
  userId: string,
): Promise<{ flowId: string } | { error: "unavailable" }> {
  const provider = getFaceMatchProvider();
  if (!provider.createLivenessSession) return { error: "unavailable" };

  const job = await db.profilePhotoVerification.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!job) return { error: "unavailable" };

  const attemptNumber = (await db.livenessSession.count({ where: { userId } })) + 1;

  let sessionId: string;
  try {
    ({ sessionId } = await provider.createLivenessSession(userId));
  } catch {
    return { error: "unavailable" };
  }

  const flowId = randomUUID();
  await db.livenessSession.create({
    data: {
      sessionId,
      userId,
      verificationId: job.id,
      provider: provider.name,
      environment: faceEnvironment(),
      status: "CREATED",
      attemptNumber,
      flowId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  await recordVerificationAudit({
    userId,
    verificationId: job.id,
    eventType: "liveness_session_created",
    actorType: "user",
    actorId: userId,
    reasonCode: "capture_started",
  });
  return { flowId };
}

type ConsumeResult =
  | { state: "liveness_processing" }
  | { state: "capture_failed" }
  | { state: "checking_profile_photos" }
  | { state: "provider_unavailable" }
  | { state: "denied" };

/**
 * Ownership-checked poll/consume by opaque flowId. Loads the session by
 * flowId + userId + environment; refuses if missing, foreign, expired,
 * invalidated, or already consumed-for-another-outcome. Consumption is
 * atomic (CONSUMED) and idempotent (replay of a consumed session returns
 * the linked result).
 */
export async function consumeLivenessFlow(flowId: string, userId: string): Promise<ConsumeResult> {
  const provider = getFaceMatchProvider();
  if (!provider.getLivenessResult) return { state: "provider_unavailable" };
  // H2: no biometric enrollment (IndexFaces) while the kill switch is on.
  if (faceEmergencyDisabled()) return { state: "provider_unavailable" };
  const environment = faceEnvironment();

  const session = await db.livenessSession.findUnique({ where: { flowId } });
  // Ownership + environment + validity binding (C-1 requirement 3/4/5).
  if (
    !session ||
    session.userId !== userId ||
    session.environment !== environment ||
    session.invalidatedAt ||
    session.status === "INVALIDATED"
  ) {
    return { state: "denied" };
  }
  if (session.status === "CONSUMED") {
    // Idempotent replay: reference already linked -> resume the check.
    return { state: "checking_profile_photos" };
  }
  if (session.expiresAt < new Date() || session.status === "EXPIRED") {
    await db.livenessSession.update({
      where: { id: session.id },
      data: { status: "EXPIRED" },
    });
    return { state: "denied" };
  }

  // Consent guard (H1): NEVER enrol a biometric reference without CURRENT
  // consent. Consent withdrawal clears the job's consent and invalidates open
  // sessions; this second check closes the race where an in-flight capture is
  // consumed after withdrawal (mirrors the run-path guard). No provider call
  // or IndexFaces happens without it.
  const consentJob = await db.profilePhotoVerification.findUnique({
    where: { id: session.verificationId },
    select: { consentAt: true, consentVersion: true },
  });
  if (!consentJob?.consentAt || consentJob.consentVersion !== BIOMETRIC_CONSENT_VERSION) {
    return { state: "denied" };
  }

  let result: { status: "pending" | "passed" | "failed"; referenceFrameReady: boolean };
  try {
    result = await provider.getLivenessResult(session.sessionId);
  } catch {
    return { state: "provider_unavailable" };
  }

  if (result.status === "pending") {
    await db.livenessSession.update({ where: { id: session.id }, data: { status: "PROCESSING" } });
    return { state: "liveness_processing" };
  }
  if (result.status === "failed") {
    await db.livenessSession.update({ where: { id: session.id }, data: { status: "FAILED" } });
    await recordVerificationAudit({
      userId,
      verificationId: session.verificationId,
      eventType: "liveness_failed",
      actorType: "system",
      reasonCode: "capture_failed",
    });
    return { state: "capture_failed" };
  }

  // PASSED. Atomically CLAIM the session for consumption so two concurrent
  // pollers can't both mint (CONSUMED transition guarded on PASSED-ish).
  const claim = await db.livenessSession.updateMany({
    where: { id: session.id, status: { in: ["CREATED", "PROCESSING"] } },
    data: { status: "PASSED" },
  });
  if (claim.count === 0) {
    // Someone else advanced it; treat as in-progress/consumed.
    return { state: "checking_profile_photos" };
  }

  // Bump referenceVersion for this enrollment, then run the saga.
  const job = await db.profilePhotoVerification.update({
    where: { id: session.verificationId },
    data: { referenceVersion: { increment: 1 } },
    select: { id: true, referenceVersion: true },
  });
  const enrolled = await enrollReferenceSaga({
    userId,
    verificationId: job.id,
    referenceVersion: job.referenceVersion,
    livenessSessionId: session.sessionId,
  });
  if (!enrolled.ok) {
    // Never orphan: the saga already persisted any minted FaceId. Roll the
    // session back to PROCESSING so a retry re-consumes the SAME session.
    await db.livenessSession.update({ where: { id: session.id }, data: { status: "PROCESSING" } });
    return { state: "provider_unavailable" };
  }

  await db.livenessSession.update({
    where: { id: session.id },
    data: { status: "CONSUMED", consumedAt: new Date() },
  });
  await recordVerificationAudit({
    userId,
    verificationId: job.id,
    eventType: "liveness_passed",
    actorType: "system",
    newStatus: "QUEUED",
    reasonCode: "reference_enrolled",
  });
  // Resume the SAME canonical job (recovery admission - already admitted).
  await enqueueProfilePhotoVerification(userId, "liveness_passed", { isRecovery: true });
  return { state: "checking_profile_photos" };
}

/**
 * Owner-scoped capture handle (TASK 1 / C-1 refinement). The AWS Amplify
 * FaceLivenessDetector MUST receive the raw sessionId in the browser to
 * stream the capture - so "sessionId never reaches the browser" is
 * softened to: the sessionId is released ONLY to the authenticated owner
 * of the flow, transiently, for the capture stream. It confers NO
 * authority - result consumption stays flowId+owner+environment bound in
 * consumeLivenessFlow. The sessionId is never placed in URLs, storage,
 * logs or analytics (client rule), and this accessor refuses foreign,
 * expired, invalidated or consumed flows.
 */
export type LivenessCaptureHandle = {
  sessionId: string;
  region: string;
  /** Short-lived STS streaming credentials for FaceLivenessDetectorCore's
   *  credentialProvider (NO Cognito). Scoped to StartFaceLivenessSession
   *  only; issued once per capture to the flow owner. */
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
    expiration: string;
  };
};

export async function getLivenessCaptureHandle(
  flowId: string,
  userId: string,
): Promise<LivenessCaptureHandle | null> {
  const environment = faceEnvironment();
  const session = await db.livenessSession.findUnique({ where: { flowId } });
  if (
    !session ||
    session.userId !== userId ||
    session.environment !== environment ||
    session.invalidatedAt ||
    ["INVALIDATED", "EXPIRED", "CONSUMED"].includes(session.status) ||
    session.expiresAt < new Date()
  ) {
    return null;
  }
  const { getFaceMatchProvider } = await import("@/lib/services/face-match-providers");
  const { assumeLivenessStreamingRole, livenessStreamingConfigured } =
    await import("@/lib/services/aws-sts");
  // Mock provider needs no real streaming creds (dev/tests): a placeholder
  // keeps the flow exercisable. Real providers REQUIRE the STS role.
  const region = getFaceMatchProvider().region ?? "eu-west-1";
  if (!livenessStreamingConfigured()) {
    if (getFaceMatchProvider().name === "mock") {
      return {
        sessionId: session.sessionId,
        region,
        credentials: {
          accessKeyId: "MOCK",
          secretAccessKey: "MOCK",
          sessionToken: "MOCK",
          expiration: new Date(Date.now() + 900_000).toISOString(),
        },
      };
    }
    return null; // streaming role not configured for a real provider
  }
  // Owner-scoped: the session id already proved ownership above; the STS
  // session name is a non-PII hash of (flow, user).
  const credentials = await assumeLivenessStreamingRole(`${flowId}:${userId}`);
  if (!credentials) return null;
  return { sessionId: session.sessionId, region, credentials };
}

/** Invalidate all open sessions for a user (rotation / re-challenge). */
export async function invalidateOpenLivenessSessions(userId: string): Promise<void> {
  await db.livenessSession.updateMany({
    where: { userId, status: { in: ["CREATED", "PROCESSING", "PASSED"] } },
    data: { status: "INVALIDATED", invalidatedAt: new Date() },
  });
}
