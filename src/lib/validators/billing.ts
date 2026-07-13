import { z } from "zod";

/**
 * POST /api/billing/checkout body. STRICT on purpose: the browser names a
 * plan and NOTHING else - price ids, customer ids and URLs are server
 * decisions, and any extra key is a 422.
 */
export const checkoutSchema = z.strictObject({
  plan: z.enum(["PLUS", "GOLD"]),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

/**
 * POST /api/billing/change-plan body - the SAME contract as checkout: the
 * browser names a target plan and nothing else. Which change is legal
 * (strictly-higher tier, live subscription) is decided server-side in
 * changePlan() against the canonical hierarchy.
 */
export const changePlanSchema = checkoutSchema;

export type ChangePlanInput = z.infer<typeof changePlanSchema>;

/** GET /api/billing/checkout-status?session_id= */
export const checkoutStatusQuerySchema = z.object({
  session_id: z.string().min(1).max(200),
});

/**
 * POST /api/billing/portal optional body - names a portal deep-link flow
 * and nothing else. The customer id always comes from the stored row.
 */
export const portalSchema = z.strictObject({
  flow: z.enum(["payment_method_update"]).optional(),
});

export type PortalInput = z.infer<typeof portalSchema>;
