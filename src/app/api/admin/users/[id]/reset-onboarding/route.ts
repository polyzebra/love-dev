import { notFound, ok, requirePermission } from "@/lib/api";
import { db } from "@/lib/db";
import { resetOnboarding } from "@/lib/services/user-admin";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/users/[id]/reset-onboarding - set onboardingDone=false
 * so the auth gate routes the user back through onboarding on their next
 * visit. Profile data is untouched. Mirrored to AdminLog and the
 * account's AuthVerificationEvent timeline.
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const { user: actor, response } = await requirePermission("users:manage");
  if (response) return response;

  const target = await db.user.findUnique({ where: { id }, select: { id: true } });
  if (!target) return notFound("User");

  await resetOnboarding({ actorId: actor.id, userId: id, req });
  return ok({ id });
}
