import { z } from "zod";
import { apiError, guardRate, ok, parseBody, requireSession } from "@/lib/api";
import { db } from "@/lib/db";
import { getFaceMatchProvider, isFaceMatchConfigured } from "@/lib/services/face-match-providers";
import { faceRolloutConfig, isFaceCohortEligible } from "@/lib/services/face-rollout";
import {
  BIOMETRIC_CONSENT_VERSION,
  recordVerificationAudit,
} from "@/lib/services/face-verification";
import { withResilience, providerHealthState } from "@/lib/services/provider-resilience";

/**
 * POST /api/verification/liveness - create a video-selfie liveness
 * session (Phase 23). Reuses the canonical job row: the session id is
 * stored on ProfilePhotoVerification.identitySessionId's sibling field
 * (livenessSessionId is NOT a new model - we reuse referenceId=null +
 * status QUEUED with the session recorded in the audit trail and the
 * response, so no second state machine exists).
 *
 * Requires: identity verified, explicit versioned biometric consent,
 * face layer configured + liveness enabled + cohort eligible.
 * DEGRADED/UNAVAILABLE providers do NOT reject - they answer 503 with a
 * safe retry message and leave the user's state untouched.
 */
const bodySchema = z.object({ consentVersion: z.string().max(64) });

export async function POST(req: Request) {
  const { user, response } = await requireSession();
  if (response) return response;

  const limited = await guardRate(`verification:liveness:${user.id}`, {
    limit: 8,
    windowMs: 60 * 60 * 1000,
    failMode: "closed",
  });
  if (limited) return limited;

  const { data, response: invalid } = await parseBody(req, bodySchema);
  if (invalid) return invalid;
  if (data.consentVersion !== BIOMETRIC_CONSENT_VERSION) {
    return apiError(
      422,
      "consent_version_mismatch",
      "Please review and accept the current notice.",
    );
  }

  const cfg = faceRolloutConfig();
  const me = await db.user.findUnique({
    where: { id: user.id },
    select: { photoVerifiedAt: true, profile: { select: { country: true } } },
  });
  if (!me?.photoVerifiedAt) {
    return apiError(409, "identity_required", "Verify your identity first.");
  }
  if (!isFaceMatchConfigured() || !cfg.livenessEnabled) {
    return apiError(503, "liveness_unavailable", "Photo verification is coming soon.");
  }
  if (!isFaceCohortEligible(user.id, me.profile?.country)) {
    return apiError(503, "liveness_unavailable", "Photo verification is coming soon.");
  }

  const provider = getFaceMatchProvider();
  if (!provider.createLivenessSession) {
    return apiError(503, "liveness_unavailable", "Photo verification is coming soon.");
  }
  const health = await providerHealthState(`face_match:${provider.name}`);
  if (health === "UNAVAILABLE") {
    // Never reject: safe temporary state, user retries later.
    return apiError(
      503,
      "provider_unavailable",
      "We can't run this check right now. Try again later.",
    );
  }

  try {
    const session = await withResilience(`face_match:${provider.name}`, () =>
      provider.createLivenessSession!(user.id),
    );
    // Consent is stamped on the canonical job row (no new model).
    await db.profilePhotoVerification.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        provider: provider.name,
        status: "QUEUED",
        badgeStatus: "REVIEWING",
        consentVersion: BIOMETRIC_CONSENT_VERSION,
        consentAt: new Date(),
      },
      update: { consentVersion: BIOMETRIC_CONSENT_VERSION, consentAt: new Date() },
    });
    await recordVerificationAudit({
      userId: user.id,
      eventType: "liveness_session_created",
      actorType: "user",
      actorId: user.id,
      reasonCode: "capture_started",
    });
    return ok({ sessionId: session.sessionId, region: provider.region ?? null });
  } catch {
    return apiError(
      503,
      "provider_unavailable",
      "We can't run this check right now. Try again later.",
    );
  }
}
