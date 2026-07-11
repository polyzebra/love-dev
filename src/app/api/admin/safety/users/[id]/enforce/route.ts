import { z } from "zod";
import { notFound, ok, parseBody, requirePermission } from "@/lib/api";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { applyDirectAction } from "@/lib/services/trust-safety";
import { recomputeTrustForEvent } from "@/lib/services/trust-engine";

const enforceSchema = z
  .object({
    action: z.enum(["WARNING", "LIMITED", "SUSPENDED", "BANNED"]),
    violationType: z.enum([
      "PHOTO_MISMATCH",
      "STOLEN_IMAGES",
      "EXPLICIT_CONTENT",
      "MINOR_SAFETY",
      "IMPERSONATION",
      "SPAM",
      "HARASSMENT",
      "SCAM",
      "PAYMENT_ABUSE",
      "OTHER",
    ]),
    internalReason: z.string().min(3).max(1000),
    userVisibleReason: z.string().min(3).max(500).optional(),
    moderationCaseId: z.string().optional(),
    appealAllowed: z.boolean().optional(),
  })
  .strict();

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/safety/users/[id]/enforce - HUMAN enforcement decision.
 * This is the only surface that can produce BANNED (automation maxes out
 * at SUSPENDED - see trust-safety.ts). Writes the violation + status via
 * applyDirectAction (which notifies) and snapshots ban credentials.
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const { user: actor, response } = await requirePermission("safety:manage");
  if (response) return response;

  const { data, response: invalid } = await parseBody(req, enforceSchema);
  if (invalid) return invalid;

  const target = await db.user.findUnique({ where: { id }, select: { id: true } });
  if (!target) return notFound("User");

  const outcome = await applyDirectAction({
    userId: id,
    violationType: data.violationType,
    action: data.action,
    internalReason: `by ${actor.id}: ${data.internalReason}`,
    userVisibleReason: data.userVisibleReason,
    moderationCaseId: data.moderationCaseId ?? null,
    appealAllowed: data.appealAllowed,
  });
  // (applyDirectAction snapshots the ban-evasion credentials on BANNED.)

  await audit({
    actorId: actor.id,
    action: `safety.enforce.${data.action.toLowerCase()}`,
    targetType: "user",
    targetId: id,
    metadata: {
      violationId: outcome.violationId,
      violationType: data.violationType,
      ...(data.moderationCaseId ? { moderationCaseId: data.moderationCaseId } : {}),
    },
  });
  await recomputeTrustForEvent(id, "violation_added");

  return ok({ outcome });
}
