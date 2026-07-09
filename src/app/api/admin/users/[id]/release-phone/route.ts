import { notFound, ok, requirePermission } from "@/lib/api";
import { db } from "@/lib/db";
import { releasePhone } from "@/lib/services/user-admin";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/users/[id]/release-phone - free the phone number.
 * Clears phone/phoneE164/phoneVerifiedAt (and the country/dial-code
 * metadata) so the unique constraints no longer hold the number and a
 * different account can verify with it. Mirrored to AdminLog and the
 * account's AuthVerificationEvent timeline.
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const { user: actor, response } = await requirePermission("users:manage");
  if (response) return response;

  const target = await db.user.findUnique({ where: { id }, select: { id: true } });
  if (!target) return notFound("User");

  const { released } = await releasePhone({ actorId: actor.id, userId: id, req });
  return ok({ id, released });
}
