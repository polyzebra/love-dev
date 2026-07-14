import { notFound, ok, requirePermission } from "@/lib/api";
import { getVerificationSupportView } from "@/lib/services/verification-support";

type Params = { params: Promise<{ userId: string }> };

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/support/verification/[userId] - the SUPPORT-scoped view
 * of one user's verification story (Phase 15). Deliberately narrower
 * than the moderator queue: status, timeline, appeal states, policy
 * reason codes, reference lifecycle and risk band - and NOTHING else.
 * Face images, biometric templates, vendor identifiers and raw scores
 * are structurally absent from the service's return type (pinned by
 * tests).
 */
export async function GET(_req: Request, { params }: Params) {
  const { userId } = await params;
  const { response } = await requirePermission("users:read");
  if (response) return response;
  const view = await getVerificationSupportView(userId);
  if (!view) return notFound("User");
  return ok(view);
}
