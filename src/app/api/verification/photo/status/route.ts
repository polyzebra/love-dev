import { ok, requireSession } from "@/lib/api";
import { syncPhotoVerificationState } from "@/lib/services/photo-verification";

/**
 * GET /api/verification/photo/status - current photo-verification UX state
 * for the signed-in user. When a session is awaiting a provider result the
 * provider is polled and any final outcome is applied through the same
 * idempotent path the webhook uses, so webhookless dev (mock provider) and
 * "check status" taps complete the loop honestly. Never fakes progress:
 * with no provider configured it reports the stored state + configured:false.
 */
export async function GET() {
  const { user, response } = await requireSession();
  if (response) return response;

  const { state, configured } = await syncPhotoVerificationState(user.id);
  return ok({ state, configured });
}
