import { ok, requirePermission } from "@/lib/api";
import { audit } from "@/lib/audit";
import { reconcilePhoneSync } from "@/lib/services/phone-reconcile";

/**
 * POST /api/admin/phone-reconcile - run the phone split-brain
 * reconciliation between User.phoneE164 (source of truth) and
 * auth.users.phone (identity mirror). Admin-only (users:manage - it can
 * write identities). Returns the full report; `configured: false` when
 * SUPABASE_SERVICE_ROLE_KEY is absent (nothing was touched). Every run is
 * AdminLog'd with the result counts; individual repairs additionally land
 * on each account's own AuthVerificationEvent timeline.
 */
export async function POST(req: Request) {
  const { user: actor, response } = await requirePermission("users:manage");
  if (response) return response;

  const report = await reconcilePhoneSync({ actorId: actor.id, req });

  await audit({
    actorId: actor.id,
    action: "phone.reconcile",
    targetType: "system",
    metadata: {
      configured: report.configured,
      scanned: report.scanned,
      consistent: report.consistent,
      repaired: report.repaired.length,
      repairFailed: report.repairFailed.length,
      authOnly: report.authOnly.length,
      conflicts: report.conflicts.length,
    },
  });

  return ok(report);
}
