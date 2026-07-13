import { notFound, ok, parseBody, requirePermission } from "@/lib/api";
import { db } from "@/lib/db";
import { verificationReviewSchema } from "@/lib/validators/admin";
import { reviewVerification } from "@/lib/services/verification";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/verifications/[id]/review - staff verdict on a
 * verification request (Phase 0E; previously a server action only).
 * A PHOTO review stamps/clears User.photoVerifiedAt atomically with the
 * row; the owner is notified through the outbox; decision hits AdminLog.
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const { user: actor, response } = await requirePermission("verifications:review");
  if (response) return response;

  const { data, response: invalid } = await parseBody(req, verificationReviewSchema);
  if (invalid) return invalid;

  const verification = await db.verification.findUnique({ where: { id }, select: { id: true } });
  if (!verification) return notFound("Verification");

  const outcome = await reviewVerification({
    actorId: actor.id,
    verificationId: id,
    approve: data.approve,
  });
  return ok({ id, status: outcome.status });
}
