import { z } from "zod";

/**
 * The v1 transport envelope - THE contract every response obeys
 * (docs/API-CONTRACT.md). Framework-free: consumed by the server
 * helpers, the typed client, native clients and test tooling alike.
 */

/** `{ data: T }` on 2xx. */
export const successEnvelope = <T extends z.ZodTypeAny>(data: T) => z.object({ data });

/** `{ error: { code, message, fields? } }` on every non-2xx. */
export const errorEnvelopeSchema = z.object({
  error: z.object({
    /** MACHINE_READABLE code from the registry below (open for additive growth). */
    code: z.string().min(1),
    /** Safe, user-facing copy - never internals, never PII. */
    message: z.string().min(1),
    /** Per-field validation messages (422 only). */
    fields: z.record(z.string(), z.array(z.string())).optional(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

/**
 * Error-code registry with the guaranteed status mapping. The registry
 * is OPEN (new codes may be added additively); removing or re-meaning a
 * code is a breaking change and requires /api/v2.
 */
export const ERROR_STATUS: Record<string, number> = {
  // authentication / authorization
  unauthorized: 401,
  forbidden: 403,
  account_restricted: 403,
  account_unavailable: 403,
  // requests
  invalid_json: 400,
  validation_error: 422,
  not_found: 404,
  rate_limited: 429,
  // domain conflicts (409 family)
  already_subscribed: 409,
  no_customer: 409,
  no_subscription: 409,
  invalid_plan_change: 409,
  payment_past_due: 409,
  upgrade_pending: 409,
  not_ending: 409,
  no_open_invoice: 409,
  // payments
  payment_failed: 402,
  stripe_error: 502,
  billing_unavailable: 503,
  // auth funnel
  auth_unavailable: 503,
  code_failed: 400,
  too_many_attempts: 429,
  invalid_email: 400,
  send_failed: 503,
  number_unavailable: 403,
  // server
  internal_error: 500,
};

export type KnownErrorCode = keyof typeof ERROR_STATUS;
