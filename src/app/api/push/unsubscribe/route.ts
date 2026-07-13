import { guardRate, notFound, ok, parseBody, requireSession } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { pushUnsubscribeSchema } from "@/lib/validators/push";
import { revokeDeviceToken, revokePushSubscription } from "@/lib/services/push";

/**
 * POST /api/push/unsubscribe - revoke this device's subscription. Only the
 * owning user can revoke; the row is kept (revokedAt + enabled=false) so
 * device history stays auditable.
 */
export async function POST(req: Request) {
  const { user, response } = await requireSession();
  if (response) return response;

  const limited = await guardRate(`push-subscribe:${user.id}`, RATE_LIMITS.pushSubscribe);
  if (limited) return limited;

  const { data, response: invalid } = await parseBody(req, pushUnsubscribeSchema);
  if (invalid) return invalid;

  // Scoped to the session user - someone else's endpoint/token answers
  // exactly like a nonexistent one, never an ownership oracle.
  const revoked = data.endpoint
    ? await revokePushSubscription(user.id, data.endpoint, req)
    : await revokeDeviceToken(user.id, data.token!, req);
  if (!revoked) return notFound("Subscription");

  return ok({ revoked: true });
}
