import { z } from "zod";
import { apiError, ok, parseBody, requirePermission } from "@/lib/api";
import { AppealError, reviewAppeal } from "@/lib/services/appeals";

const decideSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    adminNotes: z.string().min(3).max(2000).optional(),
  })
  .strict();

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/safety/appeals/[id]/decide - human decision on an
 * appeal. Approval reverses the violation (account status recomputed,
 * photos restored, case REVERSED, ban credentials lifted); rejection
 * records the notes. Both notify the user and land in AdminLog.
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const { user: actor, response } = await requirePermission("safety:manage");
  if (response) return response;

  const { data, response: invalid } = await parseBody(req, decideSchema);
  if (invalid) return invalid;

  try {
    const result = await reviewAppeal({
      actorId: actor.id,
      appealId: id,
      decision: data.decision,
      adminNotes: data.adminNotes,
      req,
    });
    return ok(result);
  } catch (error) {
    if (error instanceof AppealError) {
      return apiError(error.httpStatus, error.code, error.message);
    }
    throw error;
  }
}
