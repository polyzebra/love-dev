import { apiError, ok, requirePermission } from "@/lib/api";
import { audit } from "@/lib/audit";
import { AppealError, markAppealUnderReview } from "@/lib/services/appeals";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/safety/appeals/[id]/under-review - staff picks up a
 * submitted appeal (SUBMITTED/PENDING_REVIEW -> UNDER_REVIEW; timeline
 * event recorded, reviewer stamped).
 */
export async function POST(_req: Request, { params }: Params) {
  const { id } = await params;
  const { user: actor, response } = await requirePermission("safety:manage");
  if (response) return response;

  try {
    const result = await markAppealUnderReview({ actorId: actor.id, appealId: id });
    await audit({
      actorId: actor.id,
      action: "appeal.under_review",
      targetType: "appeal",
      targetId: id,
    });
    return ok(result);
  } catch (error) {
    if (error instanceof AppealError) {
      return apiError(error.httpStatus, error.code, error.message);
    }
    throw error;
  }
}
