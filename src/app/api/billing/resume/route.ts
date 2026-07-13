import { apiError, guardRate, ok, requireSession } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { BillingError, BILLING_ERROR_STATUS, resumeSubscription } from "@/lib/services/billing";

/**
 * POST /api/billing/resume  (no body)
 *
 * Clears a scheduled cancellation (cancel_at_period_end / cancel_at) on
 * the user's EXISTING Stripe subscription - one subscription update, no
 * new subscription, no new customer, billing cycle untouched. The
 * response reflects state persisted from verified Stripe data.
 *
 *  200 { data: { plan, status, cancelAtPeriodEnd } }
 *  401 unauthorized
 *  409 no_subscription    - nothing live to resume (checkout instead)
 *  409 not_ending         - the membership isn't scheduled to end
 *  503 billing_unavailable
 */
export async function POST() {
  const { user, response } = await requireSession();
  if (response) return response;

  const limited = await guardRate(`billing:${user.id}`, RATE_LIMITS.billing);
  if (limited) return limited;

  try {
    const result = await resumeSubscription(user.id);
    return ok(result);
  } catch (error) {
    if (error instanceof BillingError) {
      return apiError(BILLING_ERROR_STATUS[error.code], error.code, error.message);
    }
    console.error("[billing:resume] failed:", error);
    return apiError(502, "stripe_error", "Could not resume your membership. Please try again.");
  }
}
