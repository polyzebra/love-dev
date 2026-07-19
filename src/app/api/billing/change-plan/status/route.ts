import { apiError, guardRate, ok, requireActiveAccount } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { BillingError, BILLING_ERROR_STATUS, changePlanStatus } from "@/lib/services/billing";

/**
 * GET /api/billing/change-plan/status
 *
 * Where does the authenticated user's plan change stand RIGHT NOW,
 * according to a FRESH Stripe fetch (never the DB plan alone)? Used by
 * the upgrade UI to poll after 3DS / while a payment is processing.
 *
 *  200 { data: { state: "ACTIVE_GOLD" | "STILL_PLUS" | "REQUIRES_ACTION"
 *                      | "PAYMENT_FAILED" | "PENDING",
 *                plan, status } }
 *      (REQUIRES_ACTION additionally carries the owner's clientSecret -
 *       never logged, never cached)
 *  401 unauthorized
 *  409 no_subscription
 *  503 billing_unavailable
 */
export async function GET() {
  const { user, response } = await requireActiveAccount();
  if (response) return response;

  const limited = await guardRate(`billing:${user.id}`, RATE_LIMITS.billing);
  if (limited) return limited;

  try {
    const result = await changePlanStatus(user.id);
    return ok(result);
  } catch (error) {
    if (error instanceof BillingError) {
      return apiError(BILLING_ERROR_STATUS[error.code], error.code, error.message);
    }
    console.error("[billing:change-plan/status] failed:", error);
    return apiError(502, "stripe_error", "Could not check the upgrade status.");
  }
}
