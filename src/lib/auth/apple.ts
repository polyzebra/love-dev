/**
 * THE Apple sign-in switch for the UI. Off (default) means no Apple
 * button anywhere - never a dead one. Client-safe: only literal
 * NEXT_PUBLIC_* references, so the bundler can inline them.
 *
 * Flip NEXT_PUBLIC_APPLE_LOGIN_ENABLED="true" ONLY after both:
 *   1. Apple Developer - a Services ID with Sign in with Apple enabled,
 *      the Supabase callback (https://<ref>.supabase.co/auth/v1/callback)
 *      registered as a Return URL, and a Sign in with Apple key (.p8).
 *   2. Supabase Dashboard -> Authentication -> Providers -> Apple:
 *      enabled with that Services ID + the generated client secret.
 * See docs/AUTH-SETUP.md ("Apple sign-in").
 */
export function appleLoginEnabled(): boolean {
  return (
    process.env.NEXT_PUBLIC_APPLE_LOGIN_ENABLED === "true" ||
    // Back-compat with the original flag spelling.
    process.env.NEXT_PUBLIC_APPLE_OAUTH === "1"
  );
}
