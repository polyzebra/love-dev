import { apiError, guardRate, ok, requireActiveAccount } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { portalSchema } from "@/lib/validators/billing";
import { BillingError, BILLING_ERROR_STATUS, createPortalSession } from "@/lib/services/billing";

/**
 * POST /api/billing/portal            -> portal home
 * POST /api/billing/portal { flow }   -> deep-linked portal flow
 *                                        (flow: "payment_method_update")
 *
 * Stripe billing portal session for the STORED customer id only - the
 * request never carries a customer id, so cross-user portal access is
 * structurally impossible. Plan switches, cancellations and resumes made
 * in the portal flow back through the webhook AND the billing page's
 * reconcile-on-view.
 *
 *  200 { data: { url } }
 *  401 unauthorized
 *  409 no_customer        - account has no billing profile yet
 *  422 validation_error   - unknown flow / extra keys
 *  503 billing_unavailable
 */
export async function POST(req: Request) {
  const { user, response } = await requireActiveAccount();
  if (response) return response;

  const limited = await guardRate(`billing:${user.id}`, RATE_LIMITS.billing);
  if (limited) return limited;

  // Body is optional (legacy callers send none); when present it must
  // pass the strict schema.
  const raw = await req.text();
  let flow: "payment_method_update" | undefined;
  if (raw.trim().length > 0) {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return apiError(422, "validation_error", "Malformed JSON body.");
    }
    const parsed = portalSchema.safeParse(json);
    if (!parsed.success) {
      return apiError(422, "validation_error", "Unknown portal flow.");
    }
    flow = parsed.data.flow;
  }

  try {
    const result = await createPortalSession(user.id, flow);
    return ok(result);
  } catch (error) {
    if (error instanceof BillingError) {
      return apiError(BILLING_ERROR_STATUS[error.code], error.code, error.message);
    }
    console.error("[billing:portal] failed:", error);
    return apiError(502, "stripe_error", "Could not open the billing portal. Please try again.");
  }
}
