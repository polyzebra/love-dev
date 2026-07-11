import { NextResponse } from "next/server";
import { ZodError, type ZodSchema } from "zod";
import { auth } from "@/lib/auth";
import { hasPermission, type Permission } from "@/lib/rbac";
import { rateLimit, type RateLimitResult } from "@/lib/rate-limit";

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
  return NextResponse.json({ error: { code, message, fields } }, { status });
}

export const unauthorized = () => apiError(401, "unauthorized", "Sign in to continue.");
export const forbidden = () =>
  apiError(403, "forbidden", "You do not have access to this resource.");
export const notFound = (what = "Resource") => apiError(404, "not_found", `${what} not found.`);

export function tooManyRequests(rl: RateLimitResult) {
  return NextResponse.json(
    { error: { code: "rate_limited", message: "Too many requests. Please slow down." } },
    {
      status: 429,
      headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) },
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

/** Staff session holding a specific permission, or 401/403. */
export async function requirePermission(permission: Permission) {
  const { user, response } = await requireSession();
  if (response) return { user: null, response } as const;
  if (!hasPermission(user.role, permission)) return { user: null, response: forbidden() } as const;
  return { user, response: null } as const;
}

/** Per-user or per-IP rate limit guard. */
export async function guardRate(key: string, preset: { limit: number; windowMs: number }) {
  const rl = await rateLimit(key, preset);
  if (!rl.ok) return tooManyRequests(rl);
  return null;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() ?? "unknown";
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
      return NextResponse.json({ ok: false, error: message }, { status: 503 });
    }
  };
}
