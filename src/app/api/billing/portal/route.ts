import { apiError, guardRate, ok, requireSession } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { BillingError, BILLING_ERROR_STATUS, createPortalSession } from "@/lib/services/billing";

/**
 * POST /api/billing/portal
 *
 * Stripe billing portal session for the STORED customer id only - the
 * request carries no body and no customer id, so cross-user portal
 * access is structurally impossible. Plan switches (Plus<->Gold) and
 * cancellations made in the portal flow back through the webhook.
 *
 *  200 { data: { url } }
 *  401 unauthorized
 *  409 no_customer        - account has no billing profile yet
 *  503 billing_unavailable
 */
export async function POST() {
  const { user, response } = await requireSession();
  if (response) return response;

  const limited = await guardRate(`billing:${user.id}`, RATE_LIMITS.billing);
  if (limited) return limited;

  try {
    const result = await createPortalSession(user.id);
    return ok(result);
  } catch (error) {
    if (error instanceof BillingError) {
      return apiError(BILLING_ERROR_STATUS[error.code], error.code, error.message);
    }
    console.error("[billing:portal] failed:", error);
    return apiError(502, "stripe_error", "Could not open the billing portal. Please try again.");
  }
}
