import { z } from "zod";
import { apiError, ok, parseBody, requirePermission } from "@/lib/api";
import { submitBindingReview } from "@/lib/services/face-binding-review";

type Params = { params: Promise<{ id: string }> };

const reviewSchema = z.object({
  decision: z.enum(["BOUND", "BINDING_FAILED", "REQUEST_NEW_CAPTURE"]),
  reasonCode: z.string().min(1).max(64),
  note: z.string().max(500).optional(),
});

/**
 * POST /api/admin/verification/bindings/[id]/review - the ONE authorized
 * human binding-review decision endpoint. Staff-only (safety:manage). The
 * reviewer is derived SERVER-SIDE from the session (never from the body); the
 * binding id resolves server-side. The decision goes through the review
 * service -> FaceBindingEngine.completeReview() (BOUND is never written here),
 * and a BOUND decision never sets faceVerifiedAt directly.
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const { user: actor, response } = await requirePermission("safety:manage");
  if (response) return response;

  const { data, response: invalid } = await parseBody(req, reviewSchema);
  if (invalid) return invalid;

  const result = await submitBindingReview({
    bindingId: id,
    decision: data.decision,
    reasonCode: data.reasonCode,
    note: data.note ?? null,
    reviewer: { id: actor.id }, // server-derived
  });

  if (result.ok) return ok({ id, status: result.status, granted: result.granted });

  // Neutral, non-leaking error mapping.
  const status =
    result.code === "NOT_FOUND"
      ? 404
      : result.code === "INVALID_REASON"
        ? 400
        : result.code === "EMERGENCY_DISABLED"
          ? 503
          : 409; // NOT_REVIEWABLE / CONFLICT / IDENTITY_NOT_VERIFIED / CONSENT_NOT_ACTIVE / STALE_REFERENCE
  return apiError(status, result.code.toLowerCase(), "This binding review could not be completed.");
}
