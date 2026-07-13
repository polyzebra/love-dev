import { apiError, notFound, ok, parseBody, requirePermission } from "@/lib/api";
import { db } from "@/lib/db";
import { adminUserStatusSchema } from "@/lib/validators/admin";
import { setUserStatus } from "@/lib/services/user-admin";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/users/[id]/status - reinstate / suspend / shadow ban
 * from the users list (Phase 0E; previously a server action only).
 * Lightweight ladder step: no violation row, no credential snapshot -
 * for enforcement with a recorded reason and an appeal path use the
 * safety enforce/ban routes. Self-targeting is refused, matching ban.
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const { user: actor, response } = await requirePermission("users:suspend");
  if (response) return response;
  if (actor.id === id) {
    return apiError(400, "self_target", "You cannot change your own account status.");
  }

  const { data, response: invalid } = await parseBody(req, adminUserStatusSchema);
  if (invalid) return invalid;

  const target = await db.user.findUnique({ where: { id }, select: { id: true } });
  if (!target) return notFound("User");

  await setUserStatus({ actorId: actor.id, userId: id, status: data.status, req });
  return ok({ id, status: data.status });
}
