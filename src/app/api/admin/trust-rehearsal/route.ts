import { ok, requirePermission } from "@/lib/api";
import { preflight } from "@/lib/services/trust-rehearsal";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/trust-rehearsal - admin-only readiness view for the internal
 * Trust rehearsal (Epic 5). Staff-only (safety:manage). Read-only: returns the
 * preflight PASS/WARN/FAIL checks so an admin can confirm the environment is
 * configured + legally approved before an operator-driven rehearsal. It never
 * runs the rehearsal or touches user data.
 */
export async function GET() {
  const { response } = await requirePermission("safety:manage");
  if (response) return response;
  const pf = preflight();
  return ok({ ready: pf.ok, checks: pf.checks });
}
