import { after } from "next/server";
import { ok, requireSession } from "@/lib/api";
import { consumeLivenessFlow } from "@/lib/services/face-liveness";
import { runProfilePhotoVerification } from "@/lib/services/face-verification";

type Params = { params: Promise<{ flowId: string }> };

/**
 * GET /api/verification/liveness/[flowId] - poll/consume a liveness flow.
 * Authorization is by DB ownership binding (flowId + authenticated userId
 * + environment + validity) inside consumeLivenessFlow (C-1). A foreign,
 * unknown, expired or invalidated flow returns a normalized "not in
 * progress" state - never another user's data. On PASS the reference is
 * enrolled via the saga and the canonical job resumes.
 */
export async function GET(_req: Request, { params }: Params) {
  const { flowId } = await params;
  const { user, response } = await requireSession();
  if (response) return response;

  const result = await consumeLivenessFlow(flowId, user.id);
  if (result.state === "denied") {
    return ok({ state: "session_not_found" });
  }
  if (result.state === "checking_profile_photos") {
    after(() => runProfilePhotoVerification(user.id));
  }
  return ok({ state: result.state });
}
