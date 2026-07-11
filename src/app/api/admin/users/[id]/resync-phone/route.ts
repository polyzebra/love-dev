import { apiError, notFound, ok, requirePermission } from "@/lib/api";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { findAuthPhoneHolder, syncVerifiedPhoneToAuth } from "@/lib/auth/phone-flow";

/**
 * POST /api/admin/users/[id]/resync-phone - re-run the auth.users.phone
 * mirror for an account whose verification already succeeded app-side
 * (phoneSyncStatus PENDING/FAILED, or a suspect SYNCED). Admin-only
 * (users:manage). Refuses (409) when the number is attached to a
 * DIFFERENT auth.users row - that is reconciliation-quarantine territory,
 * never an overwrite. Mirrored to AdminLog; the sync itself lands on the
 * account's AuthVerificationEvent timeline (phone_auth_sync[_failed]).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user: actor, response } = await requirePermission("users:manage");
  if (response) return response;

  const target = await db.user.findUnique({
    where: { id },
    select: { id: true, phoneE164: true, phoneVerifiedAt: true },
  });
  if (!target) return notFound("User");
  if (!target.phoneE164 || !target.phoneVerifiedAt) {
    return apiError(409, "no_verified_phone", "This account has no verified phone to sync.");
  }

  const authHolder = await findAuthPhoneHolder(target.phoneE164);
  if (authHolder && authHolder !== id) {
    return apiError(
      409,
      "auth_phone_conflict",
      "This number is attached to a different auth identity. Resolve via reconciliation - it is never overwritten.",
    );
  }

  const result = await syncVerifiedPhoneToAuth({
    userId: id,
    phoneE164: target.phoneE164,
    req,
  });

  await audit({
    actorId: actor.id,
    action: "user.resync_phone",
    targetType: "user",
    targetId: id,
    metadata: { status: result.status, errorCode: result.errorCode },
  });

  if (result.status === "FAILED") {
    // Honest failure: the durable FAILED state is recorded (reconciliation
    // picks it up); the admin should not see a success toast.
    return apiError(
      502,
      "phone_sync_failed",
      `Sync failed (${result.errorCode ?? "unknown"}). Recorded as FAILED for reconciliation.`,
    );
  }
  return ok({ id, status: result.status, errorCode: result.errorCode });
}
