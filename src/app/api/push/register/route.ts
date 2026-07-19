import { apiError, guardRate, ok, parseBody, requireActiveAccount } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { deviceRegisterSchema, validatePushEndpoint } from "@/lib/validators/push";
import {
  isPushConfigured,
  registerDeviceToken,
  registerPushSubscription,
} from "@/lib/services/push";

/**
 * POST /api/push/register - transport-independent device registration
 * (Phase 0H). WEB_PUSH keeps the exact semantics of /api/push/subscribe
 * (which remains as the web client's alias); APNS/FCM register an opaque
 * device token with rotation (a new token for the same installation
 * retires the old one) ahead of the native senders shipping.
 */
export async function POST(req: Request) {
  const { user, response } = await requireActiveAccount();
  if (response) return response;

  const limited = await guardRate(`push-subscribe:${user.id}`, RATE_LIMITS.pushSubscribe);
  if (limited) return limited;

  const { data, response: invalid } = await parseBody(req, deviceRegisterSchema);
  if (invalid) return invalid;

  if (data.transport === "WEB_PUSH") {
    if (!isPushConfigured()) {
      return apiError(503, "push_unconfigured", "Push notifications are not available right now.");
    }
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
        appVersion: data.appVersion,
      },
      req,
    );
    return ok({ transport: "WEB_PUSH", ...result });
  }

  const result = await registerDeviceToken(
    user.id,
    {
      transport: data.transport,
      token: data.token,
      installationId: data.installationId,
      platform: data.platform,
      deviceLabel: data.deviceLabel,
      appVersion: data.appVersion,
      environment: data.environment,
    },
    req,
  );
  return ok({ transport: data.transport, ...result });
}
