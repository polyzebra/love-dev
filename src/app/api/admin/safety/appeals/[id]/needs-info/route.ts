import { z } from "zod";
import { apiError, ok, parseBody, requirePermission } from "@/lib/api";
import { audit } from "@/lib/audit";
import { AppealError, requestAppealInfo } from "@/lib/services/appeals";

const needsInfoSchema = z
  .object({
    /** USER-VISIBLE question - it lands on the appeal timeline. */
    message: z.string().min(3).max(1000),
  })
  .strict();

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/safety/appeals/[id]/needs-info - staff asks the user for
 * more information. The appeal moves to NEEDS_INFO; the user has 14 days
 * to reply (one reply -> back to UNDER_REVIEW) before it auto-expires.
 * The message is user-visible; private commentary belongs in adminNotes.
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const { user: actor, response } = await requirePermission("safety:manage");
  if (response) return response;

  const { data, response: invalid } = await parseBody(req, needsInfoSchema);
  if (invalid) return invalid;

  try {
    const result = await requestAppealInfo({ actorId: actor.id, appealId: id, message: data.message });
    await audit({
      actorId: actor.id,
      action: "appeal.needs_info",
      targetType: "appeal",
      targetId: id,
      metadata: { message: data.message },
    });
    return ok(result);
  } catch (error) {
    if (error instanceof AppealError) {
      return apiError(error.httpStatus, error.code, error.message);
    }
    throw error;
  }
}
