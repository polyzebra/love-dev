import { z } from "zod";
import { apiError, guardRate, ok, parseBody, requireSession } from "@/lib/api";
import { db } from "@/lib/db";
import { isFaceMatchConfigured } from "@/lib/services/face-match-providers";
import { faceRolloutConfig } from "@/lib/services/face-rollout";
import {
  BIOMETRIC_CONSENT_VERSION,
  enqueueProfilePhotoVerification,
} from "@/lib/services/face-verification";
import { createBoundLivenessSession } from "@/lib/services/face-liveness";

/**
 * POST /api/verification/liveness - create a bound liveness session and
 * return an OPAQUE flowId (never the provider sessionId). The session is
 * persisted and bound to (userId, verificationId, environment) before the
 * flowId is returned (C-1). AWS Face Liveness is OPTIONAL and Stripe-
 * independent (L9.1.2): it requires explicit versioned consent + rollout
 * admission (C-3), NOT prior Stripe Identity. DEGRADED/UNAVAILABLE providers
 * answer 503 without rejecting the user's state.
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

  // L9.1.2/L8.3.5: AWS Face Liveness is OPTIONAL and Stripe-independent - a
  // registered user may enrol without prior Stripe Identity (photoVerifiedAt).
  // The config/legal gate below still governs whether the layer runs at all.
  // We read only the profile country, used for the rollout admission check.
  const me = await db.user.findUnique({
    where: { id: user.id },
    select: { profile: { select: { country: true } } },
  });
  if (!isFaceMatchConfigured() || !faceRolloutConfig().livenessEnabled) {
    console.warn(
      `[liveness] start refused user=…${user.id.slice(-6)} reason=layer_off ` +
        `configured=${isFaceMatchConfigured()} livenessEnabled=${faceRolloutConfig().livenessEnabled}`,
    );
    return apiError(503, "liveness_unavailable", "Photo verification is coming soon.");
  }
  // L9.8: we DO NOT pre-gate liveness on the shared `face_match:*` circuit. That
  // breaker is tripped by PHOTO-MATCH (CompareFaces/SearchFacesByImage) failures,
  // a DIFFERENT AWS API from CreateFaceLivenessSession. Gating here made a
  // photo-match outage masquerade as "verification partner unavailable" and block
  // the camera entirely. The real CreateFaceLivenessSession call below is the
  // source of truth for whether liveness can start.

  // Ensure the canonical ProfilePhotoVerification row EXISTS before we mint a
  // liveness session. A first-time enroller (esp. a non-Stripe registered user)
  // has no row yet; createBoundLivenessSession binds the AWS session to this row
  // and returns "unavailable" if it is missing. enqueue is admit-gated (the same
  // canonical gate as above), idempotent (upsert), and stamps consent - so a
  // first-time enroller lands in LIVENESS_REQUIRED with consent recorded.
  const enqueued = await enqueueProfilePhotoVerification(user.id, "liveness_enrollment", {
    consent: true,
    country: me?.profile?.country,
  });
  if (!enqueued) {
    console.warn(`[liveness] start refused user=…${user.id.slice(-6)} reason=admit_refused`);
    return apiError(503, "liveness_unavailable", "Photo verification is coming soon.");
  }

  const created = await createBoundLivenessSession(user.id);
  if ("error" in created) {
    // Distinct, logged reason (no PII): no_provider_method | no_job_row |
    // create_session_failed:<awsErrorType>. This is the exact server-side cause
    // that the client otherwise collapses into "provider unavailable".
    console.warn(
      `[liveness] CreateFaceLivenessSession failed user=…${user.id.slice(-6)} reason=${created.reason}`,
    );
    return apiError(503, "provider_unavailable", "We can't run this check right now. Try again later.");
  }
  return ok({ flowId: created.flowId });
}
