import { z } from "zod";
import {
  errorEnvelopeSchema,
  IDEMPOTENCY_HEADER,
  pageSchema,
  type ErrorEnvelope,
} from "@/lib/api-contract";

/**
 * Typed Tirvea API v1 client - framework-free (no Next.js, no React, no
 * browser assumptions): consumable by the web app, Capacitor shells,
 * native clients and test tooling.
 *
 *  - talks to the CANONICAL /api/v1 surface
 *  - cookie auth by default (same-origin web); Bearer when getAccessToken
 *    is provided (native/Capacitor - Phase 0C transport)
 *  - every response is parsed against the envelope contract; typed
 *    methods additionally validate their `data` payloads with Zod
 *  - never throws on HTTP errors: returns a discriminated result
 *  - propagates x-request-id for end-to-end correlation
 *
 * Coverage policy: core product endpoints get typed methods as clients
 * adopt them; `raw()` reaches everything else through the same envelope
 * handling. Adding a method = schema + one-liner; see docs/API-CONTRACT.md.
 */

export type TirveaClientOptions = {
  /** Origin (no trailing slash). Default "" = same-origin (web). */
  baseUrl?: string;
  /** Supply a Supabase access token to use the Bearer transport. */
  getAccessToken?: () => string | null | Promise<string | null>;
  /** Injectable fetch (tests, non-global environments). */
  fetch?: typeof fetch;
};

export type ApiResult<T> =
  | { ok: true; status: number; data: T; requestId: string | null }
  | { ok: false; status: number; error: ErrorEnvelope["error"]; requestId: string | null };

const NETWORK_ERROR: ErrorEnvelope["error"] = {
  code: "network_error",
  message: "The request could not be completed. Check your connection and try again.",
};

const MALFORMED: ErrorEnvelope["error"] = {
  code: "malformed_response",
  message: "The server returned an unexpected response.",
};

export function createTirveaClient(options: TirveaClientOptions = {}) {
  const base = options.baseUrl?.replace(/\/$/, "") ?? "";
  const doFetch = options.fetch ?? fetch;

  async function raw<T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    opts: {
      body?: unknown;
      schema?: z.ZodType<T>;
      idempotencyKey?: string;
      query?: Record<string, string | number | undefined>;
    } = {},
  ): Promise<ApiResult<T>> {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    if (opts.idempotencyKey) headers[IDEMPOTENCY_HEADER] = opts.idempotencyKey;
    const token = await options.getAccessToken?.();
    if (token) headers["authorization"] = `Bearer ${token}`;

    const query = opts.query
      ? "?" +
        new URLSearchParams(
          Object.entries(opts.query)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, String(v)]),
        ).toString()
      : "";

    let res: Response;
    try {
      res = await doFetch(`${base}/api/v1${path}${query}`, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    } catch {
      return { ok: false, status: 0, error: NETWORK_ERROR, requestId: null };
    }

    const requestId = res.headers.get("x-request-id");
    const json = (await res.json().catch(() => null)) as unknown;

    if (!res.ok) {
      const parsed = errorEnvelopeSchema.safeParse(json);
      return {
        ok: false,
        status: res.status,
        error: parsed.success ? parsed.data.error : MALFORMED,
        requestId,
      };
    }

    const data = (json as { data?: unknown } | null)?.data;
    if (opts.schema) {
      const parsed = opts.schema.safeParse(data);
      if (!parsed.success) return { ok: false, status: res.status, error: MALFORMED, requestId };
      return { ok: true, status: res.status, data: parsed.data, requestId };
    }
    return { ok: true, status: res.status, data: data as T, requestId };
  }

  // ---- Typed core methods (schemas = the v1 response contracts) --------

  const changePlanOutcome = z.object({
    outcome: z.enum([
      "PAID_AND_APPLIED",
      "ZERO_DUE_APPLIED",
      "REQUIRES_ACTION",
      "PENDING",
      "PAYMENT_FAILED",
    ]),
    plan: z.string(),
    status: z.string(),
    clientSecret: z.string().optional(),
  });

  const message = z.object({
    id: z.string(),
    conversationId: z.string(),
    senderId: z.string(),
    body: z.string().nullable(),
    createdAt: z.string(),
  });

  return {
    raw,

    auth: {
      sendEmailCode: (email: string) =>
        raw("POST", "/auth/email/send", {
          body: { email },
          schema: z.object({ retryAfter: z.number().optional() }),
        }),
      verifyEmailCode: (email: string, code: string) =>
        raw("POST", "/auth/email/verify", {
          body: { email, code },
          schema: z.object({ next: z.string() }),
        }),
    },

    billing: {
      startCheckout: (plan: "PLUS" | "GOLD") =>
        raw("POST", "/billing/checkout", {
          body: { plan },
          schema: z.object({ url: z.string(), sessionId: z.string() }),
        }),
      previewChangePlan: (plan: "PLUS" | "GOLD") =>
        raw("POST", "/billing/change-plan/preview", {
          body: { plan },
          schema: z.object({
            plan: z.string(),
            planName: z.string(),
            amountDueCents: z.number(),
            currency: z.string(),
            nextRecurringCents: z.number(),
            renewsAt: z.string().nullable(),
            expiresAt: z.string(),
          }),
        }),
      changePlan: (plan: "PLUS" | "GOLD") =>
        raw("POST", "/billing/change-plan", { body: { plan }, schema: changePlanOutcome }),
      /** Honest restore-purchases read: reports records, mutates nothing. */
      restorePurchases: () =>
        raw("GET", "/billing/purchases", {
          schema: z.object({ payments: z.number(), subscriptionTier: z.string().nullable() }),
        }),
      changePlanStatus: () =>
        raw("GET", "/billing/change-plan/status", {
          schema: z.object({
            state: z.enum([
              "ACTIVE_GOLD",
              "STILL_PLUS",
              "REQUIRES_ACTION",
              "PAYMENT_FAILED",
              "PENDING",
            ]),
            plan: z.string(),
            status: z.string(),
            clientSecret: z.string().optional(),
          }),
        }),
    },

    settings: {
      /** The caller's own settings row. */
      get: () => raw<Record<string, unknown>>("GET", "/me/settings"),
      /** Partial update; unknown fields are rejected server-side (422). */
      update: (patch: Record<string, boolean | number | string | null>) =>
        raw<Record<string, unknown>>("PATCH", "/me/settings", { body: patch }),
    },

    profile: {
      /** Replace the full prompt-answer set (max 4, curated order). */
      savePrompts: (prompts: Array<{ key: string; answer: string }>) =>
        raw("PUT", "/profile/prompts", {
          body: prompts,
          schema: z.object({ count: z.number() }),
        }),
    },

    swipes: {
      create: (input: { toUserId: string; action: string }) =>
        raw<unknown>("POST", "/swipes", { body: input }),
    },

    conversations: {
      listMessages: (conversationId: string, query?: { limit?: number; cursor?: string }) =>
        raw("GET", `/conversations/${conversationId}/messages`, {
          query,
          schema: z.union([pageSchema(message), z.object({ messages: z.array(z.unknown()) })]),
        }),
      sendMessage: (
        conversationId: string,
        body: { body: string },
        opts?: { idempotencyKey?: string },
      ) =>
        raw<unknown>("POST", `/conversations/${conversationId}/messages`, {
          body,
          idempotencyKey: opts?.idempotencyKey,
        }),
    },

    push: {
      status: () => raw<unknown>("GET", "/push/status"),
    },
  };
}

export type TirveaClient = ReturnType<typeof createTirveaClient>;
