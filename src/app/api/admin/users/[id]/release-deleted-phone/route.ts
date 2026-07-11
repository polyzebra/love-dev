import { z } from "zod";
import { apiError, notFound, ok, parseBody, requirePermission } from "@/lib/api";
import { db } from "@/lib/db";
import {
  releaseDeletedUserPhone,
  PhoneReleaseError,
  type PhoneReleaseAbortCode,
} from "@/lib/services/user-admin";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  /** Required, human-written justification - lands in AdminLog verbatim. */
  reason: z.string().trim().min(3).max(500),
  /** Optional intended next owner - validated only, NEVER attached here. */
  newOwnerUserId: z.string().trim().min(1).optional(),
});

/** Typed aborts -> HTTP. Every ambiguity is a 409 (nothing was changed). */
const ABORT_STATUS: Record<PhoneReleaseAbortCode, number> = {
  holder_not_found: 409,
  holder_mismatch: 409,
  holder_active: 409,
  concurrent_change: 409,
  invalid_new_owner: 422,
};

/**
 * POST /api/admin/users/[id]/release-deleted-phone { reason, newOwnerUserId? }
 * SUPER_ADMIN only (rbac "phones:release").
 *
 * Frees a number held by an account that is conclusively not alive
 * (status DELETED, or its auth.users row is gone - the dashboard-deletion
 * orphan class). Distinct from POST .../release-phone, which stays the
 * tool for LIVE accounts. The release NEVER attaches the number anywhere:
 * the next owner must verify it via the normal fresh-OTP flow.
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const { user: actor, response } = await requirePermission("phones:release");
  if (response) return response;

  const { data, response: bodyResponse } = await parseBody(req, bodySchema);
  if (bodyResponse) return bodyResponse;

  const target = await db.user.findUnique({
    where: { id },
    select: { id: true, phoneE164: true },
  });
  if (!target) return notFound("User");
  if (!target.phoneE164) {
    return apiError(409, "no_phone", "This account does not hold a verified phone number.");
  }

  try {
    const result = await releaseDeletedUserPhone({
      phoneE164: target.phoneE164,
      expectedOldUserId: id,
      newOwnerUserId: data.newOwnerUserId,
      reason: data.reason,
      actorId: actor.id,
      req,
    });
    return ok({
      id,
      released: result.released,
      newOwnerId: result.newOwnerId,
      authPhoneCleared: result.authPhoneCleared,
    });
  } catch (error) {
    if (error instanceof PhoneReleaseError) {
      return apiError(ABORT_STATUS[error.code], error.code, error.message);
    }
    throw error;
  }
}
