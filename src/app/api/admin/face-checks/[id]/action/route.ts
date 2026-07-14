import { z } from "zod";
import { apiError, notFound, ok, parseBody, requirePermission } from "@/lib/api";
import { adminFaceAction } from "@/lib/services/face-verification";

type Params = { params: Promise<{ id: string }> };

const actionSchema = z.object({
  action: z.enum([
    "approve",
    "reject_photo",
    "request_new_selfie",
    "suspend_badge",
    "restore_badge",
    "escalate",
  ]),
  photoCheckId: z.string().cuid().optional(),
  reasonCode: z.string().max(80).optional(),
});

/**
 * POST /api/admin/face-checks/[id]/action - staff decision on a
 * profile-photo verification. Every action writes a
 * VerificationAuditEvent (actorType "admin", actor id, previous/new
 * status, reason code) inside adminFaceAction.
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const { user: actor, response } = await requirePermission("verifications:review");
  if (response) return response;

  const { data, response: invalid } = await parseBody(req, actionSchema);
  if (invalid) return invalid;
  if (data.action === "reject_photo" && !data.photoCheckId) {
    return apiError(422, "photo_check_required", "reject_photo needs a photoCheckId.");
  }

  const result = await adminFaceAction({
    actorId: actor.id,
    verificationId: id,
    action: data.action,
    photoCheckId: data.photoCheckId,
    reasonCode: data.reasonCode,
  });
  if (!result) return notFound("Face verification");
  return ok({ id, ...result });
}
