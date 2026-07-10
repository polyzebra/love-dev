import { ok, requireSession } from "@/lib/api";
import { getVapidConfig, listPushDevices } from "@/lib/services/push";

/**
 * GET /api/push/status - the signed-in user's active push devices plus the
 * VAPID public key the client needs to subscribe. Endpoints are truncated:
 * a full endpoint is a capability URL and never leaves the server.
 */
export async function GET() {
  const { user, response } = await requireSession();
  if (response) return response;

  const config = getVapidConfig();
  const subscriptions = await listPushDevices(user.id);

  return ok({
    configured: config.configured,
    vapidPublicKey: config.publicKey,
    subscriptions,
  });
}
