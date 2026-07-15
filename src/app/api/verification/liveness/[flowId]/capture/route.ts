import { ok, requireSession, apiError } from "@/lib/api";
import { getLivenessCaptureHandle } from "@/lib/services/face-liveness";

type Params = { params: Promise<{ flowId: string }> };

/**
 * GET /api/verification/liveness/[flowId]/capture - owner-scoped capture
 * handle for the AWS Amplify FaceLivenessDetector (TASK 1). Returns the
 * raw sessionId + region ONLY to the authenticated owner of the flow
 * (ownership + environment + validity enforced in the service). The
 * sessionId confers no authority - result consumption stays flow-bound.
 * The client must NEVER persist this value to URL/storage/logs.
 */
export async function GET(_req: Request, { params }: Params) {
  const { flowId } = await params;
  const { user, response } = await requireSession();
  if (response) return response;
  const handle = await getLivenessCaptureHandle(flowId, user.id);
  if (!handle) return apiError(404, "session_not_found", "No verification session in progress.");
  return ok(handle);
}
