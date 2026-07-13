import { apiError, guardRate, ok, parseBody, requireSession } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { changePlanSchema } from "@/lib/validators/billing";
import { BillingError, BILLING_ERROR_STATUS, changePlan } from "@/lib/services/billing";

/**
 * POST /api/billing/change-plan  { plan: "PLUS" | "GOLD" }
 *
 * PAYMENT-GATED in-place upgrade of the user's EXISTING Stripe
 * subscription: proration_behavior=always_invoice raises the prorated
 * invoice NOW, payment_behavior=pending_if_incomplete keeps the OLD plan
 * until that invoice is PAID. The response names what happened to the
 * money - never a generic success:
 *
 *  200 { data: { outcome: "PAID_AND_APPLIED" | "ZERO_DUE_APPLIED"
 *                        | "REQUIRES_ACTION"  (+ clientSecret, owner-only)
 *                        | "PENDING" | "PAYMENT_FAILED",
 *                plan, status } }
 *  401 unauthorized
 *  409 no_subscription / invalid_plan_change / payment_past_due /
 *      upgrade_pending (a change is already awaiting payment)
 *  422 validation_error   - unknown plan / extra keys (no price ids,
 *                           no amounts - ever)
 *  503 billing_unavailable
 *
 * The clientSecret is returned ONLY to the authenticated owner and is
 * never logged anywhere on this path.
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
