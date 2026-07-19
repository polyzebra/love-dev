import { apiError, guardRate, ok, requireActiveAccount } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { BillingError, BILLING_ERROR_STATUS, retryPayment } from "@/lib/services/billing";

/**
 * POST /api/billing/retry-payment  (no body)
 *
 * Attempts collection of the newest OPEN invoice with the saved payment
 * method (dunning recovery). Success syncs the subscription back to
 * active through the same path the webhook uses; a declined card answers
 * an honest 402 so the UI can point at updating the payment method.
 *
 *  200 { data: { plan, status } }
 *  401 unauthorized
 *  402 payment_failed     - the charge was attempted and declined
 *  409 no_customer        - no billing profile yet
 *  409 no_open_invoice    - nothing outstanding to pay
 *  503 billing_unavailable
 */
export async function POST() {
  const { user, response } = await requireActiveAccount();
  if (response) return response;

  const limited = await guardRate(`billing:${user.id}`, RATE_LIMITS.billing);
  if (limited) return limited;

  try {
    const result = await retryPayment(user.id);
    return ok(result);
  } catch (error) {
    if (error instanceof BillingError) {
      return apiError(BILLING_ERROR_STATUS[error.code], error.code, error.message);
    }
    console.error("[billing:retry-payment] failed:", error);
    return apiError(502, "stripe_error", "Could not retry the payment. Please try again.");
  }
}
