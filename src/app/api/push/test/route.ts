import { apiError, guardRate, ok, requireSession } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { isPushConfigured } from "@/lib/services/push";
import { dispatchPushDelivery, notifyUser } from "@/lib/services/notify";
import { recordAuthEvent } from "@/lib/auth/audit";
import { db } from "@/lib/db";

/**
 * POST /api/push/test - send a real test push to every device the user has
 * registered and report the honest per-device outcome (no fake successes:
 * the results come straight from the push services' responses).
 *
 * Creates a real SYSTEM Notification so the test also shows up in the
 * in-app centre, then dispatches its PUSH delivery synchronously.
 * Strictly limited to 3/hour.
 */
export async function POST(req: Request) {
  const { user, response } = await requireSession();
  if (response) return response;

  if (!isPushConfigured()) {
    return apiError(503, "push_unconfigured", "Push notifications are not available right now.");
  }

  const limited = await guardRate(`push-test:${user.id}`, RATE_LIMITS.pushTest);
  if (limited) return limited;

  const devices = await db.pushSubscription.count({
    where: { userId: user.id, enabled: true, revokedAt: null },
  });
  if (devices === 0) {
    return apiError(409, "no_devices", "No push-enabled devices are registered.");
  }

  // A deliberate user action: unique key per click, and quiet hours do not
  // apply - the user is asking for this push right now.
  const result = await notifyUser(
    {
      userId: user.id,
      type: "SYSTEM",
      title: "Test notification",
      body: "Push notifications are working on this device.",
      url: "/settings/notifications/push",
      dedupeKey: `push-test:${user.id}:${Date.now()}`,
    },
    { bypassQuietHours: true },
  );
  if (!result.created) {
    return apiError(500, "test_failed", "Could not create the test notification.");
  }

  const delivery = await db.notificationDelivery.findFirst({
    where: { notificationId: result.notificationId, channel: "PUSH" },
    select: { id: true },
  });
  if (!delivery) {
    // Push preference for account notices is off - be explicit about it.
    return apiError(
      409,
      "push_pref_disabled",
      "Account push notifications are turned off in your settings.",
    );
  }

  const dispatch = await dispatchPushDelivery(delivery.id);

  await recordAuthEvent({
    type: "push_test_sent",
    userId: user.id,
    req,
    metadata: {
      notificationId: result.notificationId,
      status: dispatch.status,
      devices: dispatch.endpoints.length,
      delivered: dispatch.endpoints.filter((e) => e.ok).length,
    },
  });

  return ok({
    notificationId: result.notificationId,
    status: dispatch.status,
    devices: dispatch.endpoints.map((e) => ({
      endpoint: e.endpoint,
      ok: e.ok,
      statusCode: e.statusCode,
      revoked: e.revoked,
      disabled: e.disabled,
      error: e.error,
    })),
  });
}
