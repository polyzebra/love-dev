import { ok, requireActiveAccount } from "@/lib/api";
import { getPurchaseRecords } from "@/lib/services/billing";

/**
 * GET /api/billing/purchases - the "restore purchases" read (Phase 0E;
 * previously a server action only). Reports the signed-in user's own
 * payment/subscription records verbatim; never mutates anything.
 */
export async function GET() {
  const { user, response } = await requireActiveAccount();
  if (response) return response;
  return ok(await getPurchaseRecords(user.id));
}
