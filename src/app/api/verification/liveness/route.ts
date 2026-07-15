import { z } from "zod";
import { apiError, guardRate, ok, parseBody, requireSession } from "@/lib/api";
import { db } from "@/lib/db";
import { isFaceMatchConfigured } from "@/lib/services/face-match-providers";
import { admitToFaceVerification, faceRolloutConfig } from "@/lib/services/face-rollout";
import { getFaceMatchProvider } from "@/lib/services/face-match-providers";
import { BIOMETRIC_CONSENT_VERSION } from "@/lib/services/face-verification";
import { createBoundLivenessSession } from "@/lib/services/face-liveness";
import { providerHealthState } from "@/lib/services/provider-resilience";

/**
 * POST /api/verification/liveness - create a bound liveness session and
 * return an OPAQUE flowId (never the provider sessionId). The session is
 * persisted and bound to (userId, verificationId, environment) before the
 * flowId is returned (C-1). Requires identity verified + explicit
 * versioned consent + rollout admission (C-3). DEGRADED/UNAVAILABLE
 * providers answer 503 without rejecting the user's state.
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

  const me = await db.user.findUnique({
    where: { id: user.id },
    select: { photoVerifiedAt: true, profile: { select: { country: true } } },
  });
  if (!me?.photoVerifiedAt)
    return apiError(409, "identity_required", "Verify your identity first.");
  if (!isFaceMatchConfigured() || !faceRolloutConfig().livenessEnabled) {
    return apiError(503, "liveness_unavailable", "Photo verification is coming soon.");
  }
  const admit = await admitToFaceVerification(user.id, { country: me.profile?.country });
  if (!admit.admit)
    return apiError(503, "liveness_unavailable", "Photo verification is coming soon.");
  const providerName = getFaceMatchProvider().name;
  if ((await providerHealthState(`face_match:${providerName}`)) === "UNAVAILABLE") {
    return apiError(
      503,
      "provider_unavailable",
      "We can't run this check right now. Try again later.",
    );
  }

  // Consent is stamped on the canonical job row.
  await db.profilePhotoVerification
    .update({
      where: { userId: user.id },
      data: { consentVersion: BIOMETRIC_CONSENT_VERSION, consentAt: new Date() },
    })
    .catch(() => undefined);

  const created = await createBoundLivenessSession(user.id);
  if ("error" in created) {
    return apiError(
      503,
      "provider_unavailable",
      "We can't run this check right now. Try again later.",
    );
  }
  return ok({ flowId: created.flowId });
}
