import { ok, requirePermission } from "@/lib/api";
import { getFaceReadiness } from "@/lib/services/face-readiness";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/face-readiness - admin-only READ-ONLY production readiness
 * view for AWS Face Liveness. Staff-only (verifications:review). It never runs
 * anything, never mutates state, never returns a secret VALUE or biometric
 * identifier - only booleans, the provider/region/environment names, the rollout
 * percent, and the legal gate's non-secret missing-key list.
 */
export async function GET() {
  const { response } = await requirePermission("verifications:review");
  if (response) return response;
  return ok(getFaceReadiness());
}
