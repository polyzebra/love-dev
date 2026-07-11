import { db } from "@/lib/db";
import { recordAuthEvent } from "@/lib/auth/audit";
import {
  applyVerificationOutcome,
  getPhotoVerificationProvider,
  VerificationWebhookError,
} from "@/lib/services/photo-verification";
import { notifyUser } from "@/lib/services/notify";
import { sendSafetyNotice } from "@/lib/services/safety-notices";

/**
 * POST /api/webhooks/verification - provider callback for photo
 * verification sessions.
 *
 * Pattern (same stance as /api/webhooks/supabase-auth and Stripe):
 *  1. signature verification over the RAW body (provider-specific header;
 *     the mock/persona pattern is an HMAC SHA-256, Stripe uses
 *     Stripe-Signature) - unsigned/badly-signed deliveries are 401 and
 *     change NOTHING
 *  2. idempotent application: applyVerificationOutcome no-ops when the
 *     Verification row is already in the target state, so provider
 *     retries are safe (200 either way - a retry must not error-loop)
 *  3. status + provider reference only - no images, no biometrics, ever
 */
export async function POST(req: Request) {
  const provider = getPhotoVerificationProvider();
  const rawBody = await req.text();
  const signature =
    req.headers.get("x-verification-signature") ??
    req.headers.get("persona-signature") ??
    req.headers.get("stripe-signature");

  let event;
  try {
    event = await provider.handleWebhook({ rawBody, signature });
  } catch (error) {
    if (error instanceof VerificationWebhookError) {
      const status =
        error.code === "bad_signature" ? 401 : error.code === "not_configured" ? 503 : 400;
      return Response.json({ error: error.code }, { status });
    }
    throw error;
  }

  const result = await applyVerificationOutcome(provider.name, event.sessionId, event.status);

  await recordAuthEvent({
    type: "photo_verification_webhook",
    userId: result.applied ? result.userId : (result.userId ?? undefined),
    metadata: {
      provider: provider.name,
      status: event.status,
      applied: result.applied,
      ...(result.applied ? {} : { reason: result.reason }),
    },
  });

  if (result.applied) {
    if (event.status === "approved") {
      await notifyUser({
        userId: result.userId,
        type: "PROFILE_VERIFIED",
        title: "You're verified!",
        body: "Your photo verification was approved. Your badge is now live.",
        dedupeKey: `verification:${event.sessionId}:approved`,
      });
      // If verification was the pending gate, lift PHOTO_REVIEW_REQUIRED.
      await db.user.updateMany({
        where: { id: result.userId, status: "PHOTO_REVIEW_REQUIRED" },
        data: { status: "ACTIVE" },
      });
    } else if (event.status === "rejected") {
      await sendSafetyNotice(
        result.userId,
        "verification_required",
        `verification:${event.sessionId}:rejected`,
      );
    }
  }

  // 200 even for already_applied/session_not_found: retries and stale
  // deliveries must not error-loop on the provider side.
  return Response.json({
    ok: true,
    applied: result.applied,
    ...(result.applied ? {} : { reason: result.reason }),
  });
}
