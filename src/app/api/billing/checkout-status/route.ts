import { apiError, guardRate, ok, requireSession, validationError } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { checkoutStatusQuerySchema } from "@/lib/validators/billing";
import { BillingError, BILLING_ERROR_STATUS, getCheckoutStatus } from "@/lib/services/billing";

/**
 * GET /api/billing/checkout-status?session_id=cs_...
 *
 * The confirm page polls THIS instead of trusting the success redirect.
 * The session is retrieved from Stripe server-side, ownership is
 * verified (metadata.userId or the user's own Stripe customer), and a
 * completed session runs the SAME sync as the webhook before answering -
 * so a slow webhook can never strand a paying user on FREE.
 *
 *  200 { data: { state: "ACTIVE"|"PENDING"|"FAILED"|"CANCELED"|"SESSION_INVALID", plan } }
 *      plan is the plan currently GRANTED by the database (FREE until
 *      verified state lands), never an echo of client input.
 *  401 unauthorized
 *  404 not_found          - unknown OR foreign session (no enumeration)
 *  422 validation_error   - missing/malformed session_id
 *  503 billing_unavailable
 */
export async function GET(req: Request) {
  const { user, response } = await requireSession();
  if (response) return response;

  const limited = await guardRate(`billing:${user.id}`, RATE_LIMITS.billing);
  if (limited) return limited;

  const url = new URL(req.url);
  const parsed = checkoutStatusQuerySchema.safeParse({
    session_id: url.searchParams.get("session_id") ?? "",
  });
  if (!parsed.success) return validationError(parsed.error);

  try {
    const result = await getCheckoutStatus(user.id, parsed.data.session_id);
    return ok(result);
  } catch (error) {
    if (error instanceof BillingError) {
      return apiError(BILLING_ERROR_STATUS[error.code], error.code, error.message);
    }
    console.error("[billing:checkout-status] failed:", error);
    return apiError(502, "stripe_error", "Could not verify checkout. Please try again.");
  }
}
