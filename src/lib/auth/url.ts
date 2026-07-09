/**
 * Canonical site URL resolution for every auth flow.
 *
 * Order of truth:
 *   1. NEXT_PUBLIC_SITE_URL   - set this in production (https://tirvea.com)
 *   2. VERCEL_URL             - preview deployments (normalized to https://)
 *   3. window.location.origin - DEV-ONLY browser fallback so dev "just works"
 *   4. http://localhost:3000  - DEV-ONLY server-side fallback
 *
 * Production guarantees (NODE_ENV === "production"):
 *   - the browser origin is NEVER consulted (a user's address bar must not
 *     decide where Supabase redirects to)
 *   - a resolved localhost/127.0.0.1 origin is BLOCKED with a console.error
 *     and replaced by PRODUCTION_FALLBACK_ORIGIN
 *   - no configuration at all also lands on PRODUCTION_FALLBACK_ORIGIN
 *   => authRedirectUrl() can never emit a localhost URL in production.
 *
 * Never hardcode an origin in an auth redirect again - use these helpers.
 */

/**
 * Last-resort guard for a misconfigured production environment. This is NOT
 * the primary configuration - NEXT_PUBLIC_SITE_URL remains the source of
 * truth and must be set to https://tirvea.com in Vercel. This constant only
 * ensures that when the env is missing or points at localhost, auth
 * redirects still land on the real product instead of a developer machine.
 */
const PRODUCTION_FALLBACK_ORIGIN = "https://tirvea.com";

/** True when the origin points at a developer machine. */
function isLocalOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    // Unparseable "origin" - treat any localhost mention as local.
    return /localhost|127\.0\.0\.1/i.test(origin);
  }
}

export function siteUrl(): string {
  const isProd = process.env.NODE_ENV === "production";

  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const vercel = process.env.VERCEL_URL?.trim();

  let resolved: string | null = null;
  if (explicit) {
    resolved = explicit.replace(/\/+$/, "");
  } else if (vercel) {
    // VERCEL_URL is documented as host-only, but normalize defensively:
    // strip any scheme, then force https://.
    resolved = `https://${vercel.replace(/^https?:\/\//i, "").replace(/\/+$/, "")}`;
  } else if (!isProd && typeof window !== "undefined" && window.location?.origin) {
    // Browser origin is a DEV convenience only - never trusted in production.
    resolved = window.location.origin;
  }

  if (isProd) {
    if (resolved && isLocalOrigin(resolved)) {
      console.error(
        `[auth:url] localhost redirect blocked in production (resolved "${resolved}"); ` +
          `falling back to ${PRODUCTION_FALLBACK_ORIGIN}. Fix NEXT_PUBLIC_SITE_URL.`,
      );
      return PRODUCTION_FALLBACK_ORIGIN;
    }
    if (!resolved) {
      console.error(
        `[auth:url] no site URL configured in production; ` +
          `falling back to ${PRODUCTION_FALLBACK_ORIGIN}. Set NEXT_PUBLIC_SITE_URL.`,
      );
      return PRODUCTION_FALLBACK_ORIGIN;
    }
    return resolved;
  }

  return resolved ?? "http://localhost:3000";
}

/** Absolute URL for an auth redirect target, e.g. authRedirectUrl("/auth/callback"). */
export function authRedirectUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${siteUrl()}${p}`;
}
