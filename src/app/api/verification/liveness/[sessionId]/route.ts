import { apiError, ok, requireSession } from "@/lib/api";
import { db } from "@/lib/db";
import { getFaceMatchProvider } from "@/lib/services/face-match-providers";
import {
  enqueueProfilePhotoVerification,
  recordVerificationAudit,
  runProfilePhotoVerification,
} from "@/lib/services/face-verification";
import { withResilience } from "@/lib/services/provider-resilience";
import { after } from "next/server";

type Params = { params: Promise<{ sessionId: string }> };

/**
 * GET /api/verification/liveness/[sessionId] - poll one liveness session
 * and, on PASS, mint the trusted reference + enqueue the existing photo
 * check (no parallel workflow: it feeds the canonical job row).
 *
 * Session ownership is enforced: a session id is only readable by the
 * user whose job row carries it (recorded at creation in the audit
 * trail). Returns normalized states only - never vendor payloads.
 */
export async function GET(_req: Request, { params }: Params) {
  const { sessionId } = await params;
  const { user, response } = await requireSession();
  if (response) return response;

  const provider = getFaceMatchProvider();
  if (!provider.getLivenessResult || !provider.createReferenceFromLiveness) {
    return apiError(503, "liveness_unavailable", "Photo verification is coming soon.");
  }

  // Ownership: this user must have created this session (audit trail is
  // the record; a foreign session id yields 404, never another's data).
  const owned = await db.verificationAuditEvent.findFirst({
    where: { userId: user.id, eventType: "liveness_session_created" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!owned) return apiError(404, "session_not_found", "No verification session in progress.");

  try {
    const result = await withResilience(`face_match:${provider.name}`, () =>
      provider.getLivenessResult!(sessionId),
    );
    if (result.status === "pending") return ok({ state: "liveness_processing" });
    if (result.status === "failed") {
      await recordVerificationAudit({
        userId: user.id,
        eventType: "liveness_failed",
        actorType: "system",
        reasonCode: "capture_failed",
      });
      return ok({ state: "capture_failed" });
    }

    // PASSED: mint the reference from the liveness frame (idempotent at
    // the adapter) and hand off to the EXISTING photo-check pipeline.
    const ref = await withResilience(`face_match:${provider.name}`, () =>
      provider.createReferenceFromLiveness!({ userId: user.id, livenessSessionId: sessionId }),
    );
    const ttlDays = Number(process.env.FACE_REFERENCE_TTL_DAYS) || 365;
    await db.profilePhotoVerification.update({
      where: { userId: user.id },
      data: {
        referenceId: ref.referenceId,
        referenceStatus: "ACTIVE",
        referenceVersion: { increment: 1 },
        provider: provider.name,
        providerModelVersion: provider.modelVersion ?? null,
        providerRegion: provider.region ?? null,
        expiresAt: new Date(Date.now() + ttlDays * 24 * 3600 * 1000),
        status: "QUEUED",
      },
    });
    await recordVerificationAudit({
      userId: user.id,
      eventType: "liveness_passed",
      actorType: "system",
      newStatus: "QUEUED",
      reasonCode: "reference_enrolled",
    });
    await enqueueProfilePhotoVerification(user.id, "liveness_passed");
    after(() => runProfilePhotoVerification(user.id));
    return ok({ state: "checking_profile_photos" });
  } catch {
    return ok({ state: "provider_unavailable" });
  }
}
