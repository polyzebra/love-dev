import { ok, requirePermission } from "@/lib/api";
import { computeVerificationMetrics } from "@/lib/services/verification-metrics";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/verification-metrics?days=7 - anonymous aggregate
 * observability for the verification stack (Operations / Security /
 * Trust & Safety / Support dashboard groupings - see the runbook). No
 * user identifiers, biometric values or vendor identifiers in the
 * payload.
 */
export async function GET(req: Request) {
  const { response } = await requirePermission("analytics:read");
  if (response) return response;
  const days = Math.min(90, Math.max(1, Number(new URL(req.url).searchParams.get("days")) || 7));
  return ok(await computeVerificationMetrics(days));
}
