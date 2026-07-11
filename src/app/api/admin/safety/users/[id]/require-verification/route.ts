import { z } from "zod";
import { apiError, notFound, ok, parseBody, requirePermission } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requirePhotoVerification } from "@/lib/services/trust-safety";

const schema = z
  .object({
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/safety/users/[id]/require-verification - human decision
 * to gate an account behind photo verification (PHOTO_REVIEW_REQUIRED).
 * The service refuses accounts under a stronger restriction; approval of a
 * later verification lifts the state back to ACTIVE automatically.
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const { user: actor, response } = await requirePermission("safety:manage");
  if (response) return response;

  const { data, response: invalid } = await parseBody(req, schema);
  if (invalid) return invalid;

  const result = await requirePhotoVerification(id);
  if (!result.ok) {
    if (result.code === "user_not_found") return notFound("User");
    return apiError(409, result.code, result.message);
  }

  await audit({
    actorId: actor.id,
    action: "safety.require_verification",
    targetType: "user",
    targetId: id,
    metadata: { previousStatus: result.previousStatus, reason: data.reason },
  });

  return ok({ userId: id, status: "PHOTO_REVIEW_REQUIRED", previousStatus: result.previousStatus });
}
