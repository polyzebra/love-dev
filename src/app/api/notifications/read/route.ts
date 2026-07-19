import { guardRate, ok, requireActiveAccount } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { markNotificationsRead } from "@/lib/services/notify";

/**
 * POST /api/notifications/read - mark the caller's notifications read
 * (Phase 0M: the notification centre no longer mutates during render;
 * this explicit mutation fires from the client after the list paints).
 * Idempotent.
 */
export async function POST() {
  const { user, response } = await requireActiveAccount();
  if (response) return response;

  const limited = await guardRate(`api:${user.id}`, RATE_LIMITS.api);
  if (limited) return limited;

  return ok({ marked: await markNotificationsRead(user.id) });
}
