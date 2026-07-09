import { notFound, ok, requirePermission } from "@/lib/api";
import { db } from "@/lib/db";
import { releaseEmail } from "@/lib/services/user-admin";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/users/[id]/release-email - lift the identity blocklist
 * entry (BlockedIdentity) for this user's email, if one exists. Only
 * meaningful alongside a ban: the blocklist is what stops the email from
 * ever authenticating again (see isIdentityBlocked). Responds with
 * removed=false when there was nothing to lift. Mirrored to AdminLog and
 * the account's AuthVerificationEvent timeline.
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const { user: actor, response } = await requirePermission("users:manage");
  if (response) return response;

  const target = await db.user.findUnique({ where: { id }, select: { id: true } });
  if (!target) return notFound("User");

  const { removed } = await releaseEmail({ actorId: actor.id, userId: id, req });
  return ok({ id, removed });
}
