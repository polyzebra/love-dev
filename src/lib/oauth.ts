/**
 * OAuth provider configuration - edge-safe, env-only, never throws.
 *
 * Supports both naming conventions so deploys "just work":
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET   (documented convention)
 *   AUTH_GOOGLE_ID  / AUTH_GOOGLE_SECRET      (Auth.js default)
 *
 * A provider is registered ONLY when its credentials are fully present,
 * so a missing/empty variable can never produce a broken redirect like
 * "Missing required parameter: client_id" - the button simply isn't
 * offered (Apple) or explains what's missing (Google, in dev).
 */

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : undefined;
}

export const googleConfig = (() => {
  const clientId = env("GOOGLE_CLIENT_ID") ?? env("AUTH_GOOGLE_ID");
  const clientSecret = env("GOOGLE_CLIENT_SECRET") ?? env("AUTH_GOOGLE_SECRET");
  return clientId && clientSecret ? { clientId, clientSecret } : null;
})();

export const appleConfig = (() => {
  const clientId = env("APPLE_ID") ?? env("AUTH_APPLE_ID");
  // Apple's "client secret" is a signed JWT. Either provide it directly
  // (APPLE_SECRET) or provide the signing inputs and mint it at boot.
  const direct = env("APPLE_SECRET") ?? env("AUTH_APPLE_SECRET");
  if (clientId && direct) return { clientId, clientSecret: direct };
  const teamId = env("APPLE_TEAM_ID");
  const keyId = env("APPLE_KEY_ID");
  const privateKey = env("APPLE_PRIVATE_KEY");
  if (clientId && teamId && keyId && privateKey) {
    return { clientId, teamId, keyId, privateKey, clientSecret: null };
  }
  return null;
})();

/** Which variables Google sign-in still needs - for the dev-facing message. */
export const missingGoogleVars = googleConfig
  ? []
  : ([
      !(env("GOOGLE_CLIENT_ID") ?? env("AUTH_GOOGLE_ID")) && "GOOGLE_CLIENT_ID",
      !(env("GOOGLE_CLIENT_SECRET") ?? env("AUTH_GOOGLE_SECRET")) && "GOOGLE_CLIENT_SECRET",
    ].filter(Boolean) as string[]);
