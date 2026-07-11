import { z } from "zod";
import { apiError, notFound, ok, parseBody, requirePermission } from "@/lib/api";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";

const reviewSchema = z
  .object({
    action: z.enum(["under_review", "take_action", "dismiss"]),
    decisionReason: z.string().min(3).max(1000).optional(),
  })
  .strict();

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/safety/cases/[id]/review - move a moderation case
 * through its workflow. `take_action` marks the case decided; the actual
 * enforcement (violation/status change) goes through
 * /api/admin/safety/users/[id]/enforce so the graduated/direct machinery
 * and its notifications are never bypassed.
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const { user: actor, response } = await requirePermission("safety:manage");
  if (response) return response;

  const { data, response: invalid } = await parseBody(req, reviewSchema);
  if (invalid) return invalid;

  const existing = await db.moderationCase.findUnique({
    where: { id },
    select: { id: true, status: true, userId: true },
  });
  if (!existing) return notFound("Case");
  if (existing.status === "REVERSED") {
    return apiError(409, "case_closed", "A reversed case cannot be re-decided.");
  }

  const nextStatus =
    data.action === "under_review"
      ? "UNDER_REVIEW"
      : data.action === "take_action"
        ? "ACTION_TAKEN"
        : "DISMISSED";

  const updated = await db.moderationCase.update({
    where: { id },
    data: {
      status: nextStatus,
      reviewedById: actor.id,
      reviewedAt: data.action === "under_review" ? null : new Date(),
      ...(data.decisionReason ? { decisionReason: data.decisionReason } : {}),
    },
    select: { id: true, status: true, userId: true, caseType: true, severity: true },
  });

  await audit({
    actorId: actor.id,
    action: `safety.case.${data.action}`,
    targetType: "moderationCase",
    targetId: id,
    metadata: { userId: existing.userId, ...(data.decisionReason ? { decisionReason: data.decisionReason } : {}) },
  });

  return ok({ case: updated });
}
