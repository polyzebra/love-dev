import { notFound, ok, requirePermission } from "@/lib/api";
import { db } from "@/lib/db";
import { unbanUser } from "@/lib/services/user-admin";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/users/[id]/unban - restore access. Clears bannedAt +
 * banReason and sets status ACTIVE so the account can sign in again.
 * Mirrored to AdminLog and the account's AuthVerificationEvent timeline.
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const { user: actor, response } = await requirePermission("users:suspend");
  if (response) return response;

  const target = await db.user.findUnique({ where: { id }, select: { id: true } });
  if (!target) return notFound("User");

  await unbanUser({ actorId: actor.id, userId: id, req });
  return ok({ id, status: "ACTIVE" });
}
