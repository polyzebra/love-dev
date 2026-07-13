import { apiError, guardRate, ok, parseBody, requireSession } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { changePlanSchema } from "@/lib/validators/billing";
import { BillingError, BILLING_ERROR_STATUS, changePlan } from "@/lib/services/billing";

/**
 * POST /api/billing/change-plan  { plan: "PLUS" | "GOLD" }
 *
 * In-place upgrade of the user's EXISTING Stripe subscription: the
 * subscription item's price is replaced (Stripe subscription update), so
 * the customer, subscription id and billing cycle all stay put and no
 * second subscription can appear. Prorated per
 * PLAN_CHANGE_PRORATION_BEHAVIOR. The response reflects state persisted
 * from verified Stripe data - never an optimistic client-side grant.
 *
 *  200 { data: { plan, status } }
 *  401 unauthorized                 - no session
 *  409 no_subscription              - nothing live to change; UI should
 *                                     start a checkout instead
 *  409 invalid_plan_change          - same tier or a downgrade (portal)
 *  409 payment_past_due             - fix the payment method first
 *  422 validation_error             - unknown plan / extra keys
 *  503 billing_unavailable          - Stripe not configured
 */
export async function POST(req: Request) {
  const { user, response } = await requireSession();
  if (response) return response;

  const limited = await guardRate(`billing:${user.id}`, RATE_LIMITS.billing);
  if (limited) return limited;

  const { data, response: invalid } = await parseBody(req, changePlanSchema);
  if (invalid) return invalid;

  try {
    const result = await changePlan(user.id, data.plan);
    return ok(result);
  } catch (error) {
    if (error instanceof BillingError) {
      return apiError(BILLING_ERROR_STATUS[error.code], error.code, error.message);
    }
    console.error("[billing:change-plan] failed:", error);
    return apiError(502, "stripe_error", "Could not change your plan. Please try again.");
  }
}
