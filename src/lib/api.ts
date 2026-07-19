import { NextResponse } from "next/server";
import { ZodError, type ZodSchema } from "zod";
import { auth } from "@/lib/auth";
import { registrationComplete } from "@/lib/auth/gate";
import { hasPermission, type Permission } from "@/lib/rbac";
import { rateLimit, type RateLimitPreset, type RateLimitResult } from "@/lib/rate-limit";

/**
 * API layer conventions:
 *  - every response is `{ data }` or `{ error: { code, message, fields? } }`
 *  - handlers use these helpers so status codes and shapes stay consistent
 */

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data }, init);
}

export function created<T>(data: T) {
  return NextResponse.json({ data }, { status: 201 });
}

export function apiError(
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string[]>,
) {
  if (status >= 500) {
    // Observability (Phase 0M): safe machine code only - the message is
    // user-facing copy and fields never carry values, but neither is
    // needed to alert on 5xx rates.
    console.error(`[api] error status=${status} code=${code}`);
  }
  return NextResponse.json({ error: { code, message, fields } }, { status });
}

export const unauthorized = () => apiError(401, "unauthorized", "Sign in to continue.");
export const forbidden = () =>
  apiError(403, "forbidden", "You do not have access to this resource.");
export const notFound = (what = "Resource") => apiError(404, "not_found", `${what} not found.`);

export function tooManyRequests(rl: RateLimitResult) {
  const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
  return NextResponse.json(
    {
      error: {
        code: "rate_limited",
        message: "Too many requests. Please slow down.",
        retryAfter,
      },
    },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfter) },
    },
  );
}

export function validationError(error: ZodError) {
  return apiError(
    422,
    "validation_error",
    "Some fields need attention.",
    error.flatten().fieldErrors as Record<string, string[]>,
  );
}

/** Parse + validate a JSON body against a schema. Returns a NextResponse on failure. */
export async function parseBody<T>(
  req: Request,
  schema: ZodSchema<T>,
): Promise<{ data: T; response: null } | { data: null; response: NextResponse }> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return {
      data: null,
      response: apiError(400, "invalid_json", "Request body must be valid JSON."),
    };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return { data: null, response: validationError(parsed.error) };
  return { data: parsed.data, response: null };
}

export const accountRestricted = () =>
  apiError(
    403,
    "account_restricted",
    "This account is restricted. Visit your account status page for details.",
  );

/**
 * Authenticated session or a 401 response.
 *
 * Trust & safety: SUSPENDED/BANNED sessions exist (auth() keeps them so the
 * status/appeal surfaces work) but are refused HERE - the single choke
 * point for every API route - with 403 account_restricted. The ONLY routes
 * that may pass `allowRestricted: true` are the account-status read model
 * and appeal submission.
 */
export async function requireSession(opts?: { allowRestricted?: boolean }) {
  const session = await auth();
  if (!session?.user?.id) return { user: null, response: unauthorized() } as const;
  const { user } = session;
  const restricted = user.status === "SUSPENDED" || user.status === "BANNED" || !!user.bannedAt;
  if (restricted && !opts?.allowRestricted) {
    return { user: null, response: accountRestricted() } as const;
  }
  return { user, response: null } as const;
}

/** 403 for a valid session whose registration is not yet complete. */
export const registrationIncomplete = () =>
  apiError(
    403,
    "registration_incomplete",
    "Finish creating your account to use this feature.",
  );

/**
 * Session guard for POST-ACTIVATION product features (L7.3.8). Layers the
 * canonical registration resolver on top of requireSession: an authenticated
 * but incomplete account (PENDING / mid-ladder) is refused with 403
 * registration_incomplete. This is the ONE completeness gate - every
 * post-activation feature route uses it, never a bespoke status check.
 * Registration/setup routes keep plain requireSession (they must run while
 * the account is still incomplete).
 */
export async function requireActiveAccount(opts?: { allowRestricted?: boolean }) {
  const { user, response } = await requireSession(opts);
  if (response) return { user: null, response } as const;
  if (!registrationComplete(user)) {
    return { user: null, response: registrationIncomplete() } as const;
  }
  return { user, response: null } as const;
}

/** Staff session holding a specific permission, or 401/403. */
export async function requirePermission(permission: Permission) {
  const { user, response } = await requireSession();
  if (response) return { user: null, response } as const;
  if (!hasPermission(user.role, permission)) return { user: null, response: forbidden() } as const;
  return { user, response: null } as const;
}

/**
 * Per-user or per-IP-hash rate limit guard. Key format `action:principal`;
 * IP principals must be HASHES (ipHashFrom), never raw addresses. Every
 * preset carries an explicit failMode (docs/RATE-LIMITING.md).
 */
export async function guardRate(key: string, preset: RateLimitPreset) {
  const rl = await rateLimit(key, preset);
  if (!rl.ok) {
    // Observability (Phase 0M): the action segment only - principals
    // (user ids / IP hashes) never reach logs.
    console.warn(
      `[rate-limit] blocked action=${key.split(":")[0]}` +
        `${rl.degraded ? " degraded=true" : ""} retryInMs=${Math.max(0, rl.resetAt - Date.now())}`,
    );
    return tooManyRequests(rl);
  }
  return null;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() ?? "unknown";
}

/** 500 with the standard envelope and nothing internal leaked. */
export const internalError = () =>
  apiError(500, "internal_error", "Something went wrong on our side. Please try again.");

// ---------------------------------------------------------------------------
// Idempotency (v1 contract - lib/api-contract/idempotency.ts)
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";
import {
  IDEMPOTENCY_HEADER,
  IDEMPOTENCY_REPLAYED_HEADER,
  idempotencyKeySchema,
} from "@/lib/api-contract/idempotency";

/**
 * Opt-in idempotency for unsafe mutations: when the request carries a
 * well-formed Idempotency-Key, the first execution's response is stored
 * per (user, scope, key) and replayed on duplicates. Only non-5xx
 * responses are stored (a 5xx retries for real). A concurrent same-key
 * race is resolved by the unique constraint: the loser replays the
 * winner's stored response. Requests without the header are untouched.
 */
export async function withIdempotency(
  userId: string,
  scope: string,
  req: Request,
  exec: () => Promise<NextResponse>,
): Promise<NextResponse> {
  const raw = req.headers.get(IDEMPOTENCY_HEADER);
  if (!raw) return exec();
  const key = idempotencyKeySchema.safeParse(raw);
  if (!key.success) {
    return apiError(422, "validation_error", "Idempotency-Key is malformed.");
  }

  const replay = (stored: { status: number; response: unknown }) =>
    NextResponse.json(stored.response, {
      status: stored.status,
      headers: { [IDEMPOTENCY_REPLAYED_HEADER]: "true" },
    });

  const where = { userId_scope_key: { userId, scope, key: key.data } };
  const existing = await db.apiIdempotencyKey.findUnique({ where });
  if (existing) return replay(existing);

  const res = await exec();
  if (res.status < 500) {
    const body = await res
      .clone()
      .json()
      .catch(() => null);
    if (body !== null) {
      try {
        await db.apiIdempotencyKey.create({
          data: { userId, scope, key: key.data, status: res.status, response: body },
        });
      } catch {
        // Unique-constraint race: someone stored first - replay theirs so
        // both callers observe ONE canonical outcome.
        const winner = await db.apiIdempotencyKey.findUnique({ where });
        if (winner) return replay(winner);
      }
    }
  }
  return res;
}

// ---------------------------------------------------------------------------
// Auth-funnel envelopes (Phase 0D migration)
//
// The OTP send/verify routes historically answered `{ ok, retryAfter }`
// / `{ ok: false, error: "<string>" }` - the one divergence from the
// standard `{ data }` / `{ error: { code, message } }` contract. These
// helpers emit the STANDARD envelope while mirroring the legacy keys
// (`ok`, top-level success fields, top-level `code`) so cached bundles
// keep working. The legacy mirrors are DEPRECATED and removed with the
// bare /api/* alias (docs/API-CONTRACT.md).
// ---------------------------------------------------------------------------

export function authOk(fields: Record<string, unknown>, init?: ResponseInit) {
  return NextResponse.json({ ok: true, ...fields, data: fields }, init);
}

export function authError(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
) {
  return NextResponse.json(
    { ok: false, code, ...extra, error: { code, message, ...extra } },
    { status },
  );
}

/**
 * Wrap an auth-funnel handler so an infrastructure failure (database
 * unreachable, required env missing) answers a clear 503 with neutral
 * copy instead of an anonymous 500. The DB-backed limits and locks in
 * these routes fail CLOSED - nothing proceeds unaudited.
 */
export function withUnavailableGuard(
  label: string,
  handler: (req: Request) => Promise<Response>,
  message = "Sign-in is temporarily unavailable. Please try again shortly.",
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    try {
      return await handler(req);
    } catch (error) {
      console.error(`[${label}] unavailable:`, error);
      return authError(503, "auth_unavailable", message);
    }
  };
}
