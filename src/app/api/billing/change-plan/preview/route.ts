import { apiError, guardRate, ok, parseBody, requireActiveAccount } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { changePlanSchema } from "@/lib/validators/billing";
import { BillingError, BILLING_ERROR_STATUS, previewChangePlan } from "@/lib/services/billing";

/**
 * POST /api/billing/change-plan/preview  { plan: "PLUS" | "GOLD" }
 *
 * The exact Stripe proration preview for upgrading the authenticated
 * user's OWN subscription - what would be collected today, the new
 * recurring amount, and the unchanged renewal date. Nothing is created
 * or charged. The browser names a plan and NOTHING else: price ids,
 * item ids and amounts are all resolved server-side from the stored
 * customer mapping.
 *
 *  200 { data: { plan, planName, amountDueCents, currency, taxCents,
 *                nextRecurringCents, renewsAt, expiresAt } }
 *  401 unauthorized
 *  409 no_subscription / invalid_plan_change / payment_past_due /
 *      upgrade_pending
 *  422 validation_error
 *  503 billing_unavailable
 */
export async function POST(req: Request) {
  const { user, response } = await requireActiveAccount();
  if (response) return response;

  const limited = await guardRate(`billing:${user.id}`, RATE_LIMITS.billing);
  if (limited) return limited;

  const { data, response: invalid } = await parseBody(req, changePlanSchema);
  if (invalid) return invalid;

  try {
    const result = await previewChangePlan(user.id, data.plan);
    return ok(result);
  } catch (error) {
    if (error instanceof BillingError) {
      return apiError(BILLING_ERROR_STATUS[error.code], error.code, error.message);
    }
    console.error("[billing:change-plan/preview] failed:", error);
    return apiError(502, "stripe_error", "Could not preview the upgrade. Please try again.");
  }
}
