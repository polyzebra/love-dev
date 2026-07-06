import { appleConfig, googleConfig, missingGoogleVars } from "@/lib/oauth";

/**
 * Non-secret OAuth availability for the auth UI. Exposes only booleans
 * and the NAMES of missing variables (never values) so the login page
 * can hide Apple when unconfigured and explain a missing Google setup
 * instead of redirecting into a broken consent screen.
 */
export function GET() {
  return Response.json({
    google: !!googleConfig,
    apple: !!appleConfig,
    missingGoogleVars,
  });
}
