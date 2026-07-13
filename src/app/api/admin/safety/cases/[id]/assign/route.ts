import { z } from "zod";
import { apiError, notFound, ok, parseBody, requirePermission } from "@/lib/api";
import { audit } from "@/lib/audit";
import { assignCase, unassignCase } from "@/lib/services/trust-safety";

const assignSchema = z
  .object({
    /** Staff user id to assign; null clears the assignment. */
    assigneeId: z.string().min(1).nullable(),
  })
  .strict();

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/safety/cases/[id]/assign - assign a moderation case to a
 * staff member (assigneeId) or clear the assignment (null). Reassigning
 * someone else's case is deliberate queue management, so safety:manage;
 * self-service claiming lives at /claim for moderators.
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const { user: actor, response } = await requirePermission("safety:manage");
  if (response) return response;

  const { data, response: invalid } = await parseBody(req, assignSchema);
  if (invalid) return invalid;

  const result = data.assigneeId ? await assignCase(id, data.assigneeId) : await unassignCase(id);
  if (!result.ok) {
    if (result.code === "case_not_found") return notFound("Case");
    return apiError(result.code === "assignee_not_staff" ? 422 : 409, result.code, result.message);
  }

  await audit({
    actorId: actor.id,
    action: data.assigneeId ? "safety.case.assign" : "safety.case.unassign",
    targetType: "moderationCase",
    targetId: id,
    metadata: { assigneeId: data.assigneeId },
  });

  return ok({ caseId: id, assignedToId: result.assignedToId });
}
