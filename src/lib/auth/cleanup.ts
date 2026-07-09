import { db } from "@/lib/db";
import { recordAuthEvent } from "@/lib/auth/audit";

/**
 * Abandoned-signup sweeper. Requesting an email OTP creates an
 * auth.users row BEFORE the code is entered (shouldCreateUser: true -
 * Supabase behavior). Until verifyOtp succeeds and ensureAppUser() runs,
 * that row is a ghost: no confirmed email, no app "User" row, invisible
 * to the product and the admin (both read the Prisma User table only).
 *
 * This deletes ghosts older than 24 hours. Every guard matters:
 *  - email_confirmed_at IS NULL AND phone_confirmed_at IS NULL:
 *    never touch anyone who completed any verification
 *  - created_at < now() - 24h: a signup still in progress survives
 *  - id NOT IN "User": an app row means a real account, even if the
 *    auth flags look odd - never delete it
 *  - is_sso_user = false: OAuth/SAML identities are managed by their
 *    provider flow, not this sweeper
 *
 * auth.identities / auth.sessions / auth.one_time_tokens / mfa_factors
 * etc. all reference auth.users with ON DELETE CASCADE (verified against
 * pg_catalog on the live project), so one DELETE is sufficient and safe.
 */
export async function cleanupAbandonedAuthUsers(): Promise<number> {
  try {
    const deleted = await db.$executeRaw`
      DELETE FROM auth.users
      WHERE email_confirmed_at IS NULL
        AND phone_confirmed_at IS NULL
        AND created_at < now() - interval '24 hours'
        AND id::text NOT IN (SELECT id FROM "User")
        AND is_sso_user = false`;
    await recordAuthEvent({
      type: "auth_cleanup",
      userId: null,
      metadata: { count: deleted },
    });
    return deleted;
  } catch (error) {
    console.error("[auth:cleanup] abandoned auth.users sweep failed:", error);
    return 0;
  }
}
