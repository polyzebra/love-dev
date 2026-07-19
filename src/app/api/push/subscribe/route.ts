import { apiError, guardRate, ok, parseBody, requireActiveAccount } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { pushSubscribeSchema, validatePushEndpoint } from "@/lib/validators/push";
import { isPushConfigured, registerPushSubscription } from "@/lib/services/push";

/**
 * POST /api/push/subscribe - register (or refresh) this device's Web Push
 * subscription for the signed-in user. Endpoints must be https on a known
 * push-service host (never our own origin or a private address); rows are
 * upserted by endpoint and rebound with an audit entry when a device
 * changes account (see registerPushSubscription).
 */
export async function POST(req: Request) {
  const { user, response } = await requireActiveAccount();
  if (response) return response;

  if (!isPushConfigured()) {
    return apiError(503, "push_unconfigured", "Push notifications are not available right now.");
  }

  const limited = await guardRate(`push-subscribe:${user.id}`, RATE_LIMITS.pushSubscribe);
  if (limited) return limited;

  const { data, response: invalid } = await parseBody(req, pushSubscribeSchema);
  if (invalid) return invalid;

  const endpointCheck = validatePushEndpoint(
    data.subscription.endpoint,
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL,
  );
  if (!endpointCheck.ok) {
    return apiError(400, endpointCheck.reason, "That push endpoint cannot be registered.");
  }

  const result = await registerPushSubscription(
    user.id,
    {
      endpoint: data.subscription.endpoint,
      p256dh: data.subscription.keys.p256dh,
      auth: data.subscription.keys.auth,
      userAgent: data.userAgent ?? req.headers.get("user-agent")?.slice(0, 512),
      platform: data.platform,
      browser: data.browser,
      deviceLabel: data.deviceLabel,
      installationId: data.installationId,
    },
    req,
  );

  return ok(result);
}
