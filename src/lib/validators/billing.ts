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

/** GET /api/billing/checkout-status?session_id= */
export const checkoutStatusQuerySchema = z.object({
  session_id: z.string().min(1).max(200),
});
