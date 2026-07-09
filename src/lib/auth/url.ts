/**
 * Canonical site URL resolution for every auth flow.
 *
 * Order of truth:
 *   1. NEXT_PUBLIC_SITE_URL  - set this in production (https://tirvea.com)
 *   2. VERCEL_URL            - preview deployments (https:// prefixed)
 *   3. window.location.origin - browser fallback so dev "just works"
 *   4. http://localhost:3000  - server-side dev fallback
 *
 * Never hardcode an origin in an auth redirect again - use these helpers.
 */

export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit && explicit.trim().length > 0) return explicit.trim().replace(/\/+$/, "");

  const vercel = process.env.VERCEL_URL;
  if (vercel && vercel.trim().length > 0) return `https://${vercel.trim().replace(/\/+$/, "")}`;

  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;

  return "http://localhost:3000";
}

/** Absolute URL for an auth redirect target, e.g. authRedirectUrl("/auth/callback"). */
export function authRedirectUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${siteUrl()}${p}`;
}
