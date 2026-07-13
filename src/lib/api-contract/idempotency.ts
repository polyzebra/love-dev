import { z } from "zod";

/**
 * v1 idempotency standard (docs/API-CONTRACT.md).
 *
 * Mutations where a duplicate request is harmful accept an
 * `Idempotency-Key` header. Semantics:
 *  - same authenticated user + same endpoint scope + same key
 *    -> the FIRST execution's response is stored and replayed
 *       (with an `Idempotency-Replayed: true` header) instead of
 *       re-executing;
 *  - keys are client-generated (UUIDs recommended), valid for 24h;
 *  - only non-5xx responses are stored - a 5xx may be retried with the
 *    SAME key and will re-execute;
 *  - requests WITHOUT the header behave exactly as before (opt-in).
 *
 * Endpoints honouring it today: POST /api/v1/conversations/:id/messages.
 * Billing mutations are already idempotent server-side via
 * state-derived Stripe idempotency keys and do not need the header.
 */

export const IDEMPOTENCY_HEADER = "idempotency-key";
export const IDEMPOTENCY_REPLAYED_HEADER = "idempotency-replayed";

/** Client-supplied key shape: opaque, printable, bounded. */
export const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, "printable key characters only");
