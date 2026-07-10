import { ok, requirePermission } from "@/lib/api";
import { audit } from "@/lib/audit";
import { cleanupAbandonedAuthUsers, cleanupStalePhoneClaims } from "@/lib/auth/cleanup";

/**
 * POST /api/admin/auth-cleanup - manually sweep abandoned (ghost)
 * auth.users rows: OTP requested >24h ago, never confirmed, no app
 * User row. The same sweep runs daily via cron; this is the on-demand
 * admin trigger. Mirrored to AdminLog with the deleted count.
 */
export async function POST() {
  const { user: actor, response } = await requirePermission("users:delete");
  if (response) return response;

  const deleted = await cleanupAbandonedAuthUsers();
  const phoneClaimsCleared = await cleanupStalePhoneClaims();
  await audit({
    actorId: actor.id,
    action: "auth.cleanup",
    metadata: { deleted, phoneClaimsCleared },
  });
  return ok({ deleted, phoneClaimsCleared });
}
