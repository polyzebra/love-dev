import { apiError, guardRate, ok, parseBody, requireActiveAccount } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { checkoutSchema } from "@/lib/validators/billing";
import { BillingError, BILLING_ERROR_STATUS, startCheckout } from "@/lib/services/billing";

/**
 * POST /api/billing/checkout  { plan: "PLUS" | "GOLD" }
 *
 * Creates a Stripe Checkout Session and answers { url, sessionId }; the
 * client's ONLY job is redirecting to url. Nothing about the plan is
 * granted here - entitlements change exclusively when verified Stripe
 * state lands via the webhook or checkout-status reconciliation.
 *
 *  201 { data: { url, sessionId } }
 *  401 unauthorized                 - no session
 *  409 already_subscribed           - live subscription exists; UI should
 *                                     open the billing portal instead
 *  422 validation_error             - unknown plan / extra keys
 *  503 billing_unavailable          - Stripe not configured
 */
export async function POST(req: Request) {
  const { user, response } = await requireActiveAccount();
  if (response) return response;

  const limited = await guardRate(`billing:${user.id}`, RATE_LIMITS.billing);
  if (limited) return limited;

  const { data, response: invalid } = await parseBody(req, checkoutSchema);
  if (invalid) return invalid;

  try {
    const result = await startCheckout(user.id, data.plan, user.email);
    return ok(result, { status: 201 });
  } catch (error) {
    if (error instanceof BillingError) {
      return apiError(BILLING_ERROR_STATUS[error.code], error.code, error.message);
    }
    console.error("[billing:checkout] failed:", error);
    return apiError(502, "stripe_error", "Could not start checkout. Please try again.");
  }
}
