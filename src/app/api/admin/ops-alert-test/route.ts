import { ok, requirePermission } from "@/lib/api";
import { sendTestOpsAlert } from "@/lib/services/provider-resilience";

/**
 * POST /api/admin/ops-alert-test - admin dry-run of the external ops alert
 * channel. Staff-only (verifications:review). Sends ONE synthetic alert
 * through the external channel (no PII, no admin outbox spam) and reports
 * whether it was configured + delivered. Never throws.
 */
export async function POST() {
  const { response } = await requirePermission("verifications:review");
  if (response) return response;
  const result = await sendTestOpsAlert("admin dry-run");
  return ok(result);
}
