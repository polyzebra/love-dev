import { ok, requirePermission } from "@/lib/api";
import { getLivenessFlowDiagnostic } from "@/lib/services/face-liveness";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/liveness-diagnostic - admin-only (verifications:review) non-PII
 * snapshot of ONE liveness flow: the requester's latest by default, or a
 * specified `?userId=`. It reads the current provider status on demand (a pure
 * GetFaceLivenessSessionResults - never consumes/enrolls), so the real AWS status
 * of a stuck "Verifying…" attempt is observable even when Vercel logs are not.
 *
 * Returns ONLY: flow suffix, application state, provider status, attempt age,
 * consumed boolean, checkedAt, last safe error code, reference-enrolled boolean,
 * and profile-photo-verification status. NEVER the full flowId/sessionId,
 * credentials, email, uid, media or scores.
 */
export async function GET(req: Request) {
  const { user, response } = await requirePermission("verifications:review");
  if (response) return response;
  const targetUserId = new URL(req.url).searchParams.get("userId")?.trim() || user.id;
  return ok(await getLivenessFlowDiagnostic(targetUserId));
}
