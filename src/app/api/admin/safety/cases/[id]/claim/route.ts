import { apiError, notFound, ok, requirePermission } from "@/lib/api";
import { audit } from "@/lib/audit";
import { claimCase } from "@/lib/services/trust-safety";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/safety/cases/[id]/claim - take an unassigned case for
 * yourself. Atomic: a case someone else already holds is a 409 (a claim
 * must never steal - reassignment goes through /assign with
 * safety:manage). Claiming is queue triage, so moderators (safety:read)
 * may do it.
 */
export async function POST(_req: Request, { params }: Params) {
  const { id } = await params;
  const { user: actor, response } = await requirePermission("safety:read");
  if (response) return response;

  const result = await claimCase(id, actor.id);
  if (!result.ok) {
    if (result.code === "case_not_found") return notFound("Case");
    return apiError(409, result.code, result.message);
  }

  await audit({
    actorId: actor.id,
    action: "safety.case.claim",
    targetType: "moderationCase",
    targetId: id,
  });

  return ok({ caseId: id, assignedToId: result.assignedToId });
}
