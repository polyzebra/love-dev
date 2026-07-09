import { z } from "zod";
import { apiError, notFound, ok, parseBody, requirePermission } from "@/lib/api";
import { db } from "@/lib/db";
import { banUser } from "@/lib/services/user-admin";

type Params = { params: Promise<{ id: string }> };

const banSchema = z.object({
  reason: z.string().trim().min(3, "Give a reason the user (and audit trail) can understand."),
});

/**
 * POST /api/admin/users/[id]/ban - ban with a REQUIRED reason.
 * Sets bannedAt + banReason + status SUSPENDED; the auth gate
 * (authNextStep) then routes the account to /account-blocked and
 * auth() refuses to mint sessions for it. Mirrored to AdminLog and
 * the account's AuthVerificationEvent timeline.
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const { user: actor, response } = await requirePermission("users:suspend");
  if (response) return response;
  if (actor.id === id) return apiError(400, "self_target", "You cannot ban your own account.");

  const { data, response: bodyError } = await parseBody(req, banSchema);
  if (bodyError) return bodyError;

  const target = await db.user.findUnique({ where: { id }, select: { id: true } });
  if (!target) return notFound("User");

  await banUser({ actorId: actor.id, userId: id, reason: data.reason, req });
  return ok({ id, status: "SUSPENDED" });
}
