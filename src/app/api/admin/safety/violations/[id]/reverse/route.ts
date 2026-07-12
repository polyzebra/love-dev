import { z } from "zod";
import { apiError, notFound, ok, parseBody, requirePermission } from "@/lib/api";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { reverseViolation } from "@/lib/services/trust-safety";
import { recomputeTrustForEvent } from "@/lib/services/trust-engine";
import { sendSafetyNotice } from "@/lib/services/safety-notices";

const reverseSchema = z
  .object({
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/safety/violations/[id]/reverse - human reversal of one
 * enforcement action outside the appeal flow (false positive / staff
 * reinstatement). Delegates to trust-safety.reverseViolation: account
 * status recomputed from what remains, hidden photo restored, linked case
 * -> REVERSED, ban credentials lifted when no ban remains. A written
 * reason is required and lands in AdminLog.
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const { user: actor, response } = await requirePermission("safety:manage");
  if (response) return response;

  const { data, response: invalid } = await parseBody(req, reverseSchema);
  if (invalid) return invalid;

  const violation = await db.accountViolation.findUnique({
    where: { id },
    select: { id: true, userId: true, reversedAt: true, actionTaken: true },
  });
  if (!violation) return notFound("Violation");
  if (violation.reversedAt) {
    return apiError(409, "already_reversed", "This action was already reversed.");
  }

  const result = await reverseViolation(id);

  await audit({
    actorId: actor.id,
    action: "safety.violation.reverse",
    targetType: "accountViolation",
    targetId: id,
    metadata: {
      userId: violation.userId,
      actionTaken: violation.actionTaken,
      restoredStatus: result.restoredStatus,
      restoredPhotoIds: result.restoredPhotoIds,
      reason: data.reason,
    },
  });
  await recomputeTrustForEvent(violation.userId, "appeal_decided");
  // Tell the user the restriction was lifted (staff reversal outside the
  // appeal flow - the appeal path sends appeal_approved instead).
  await sendSafetyNotice(violation.userId, "restriction_lifted", `violation:${id}:reversed`, {
    violationId: id,
  });

  return ok({
    violationId: id,
    restoredStatus: result.restoredStatus,
    restoredPhotoIds: result.restoredPhotoIds,
  });
}
