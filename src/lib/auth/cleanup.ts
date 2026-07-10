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
/**
 * REPAIR GUARD for the Supabase phone_change flow: with the Supabase
 * provider, sendCode = auth.updateUser({ phone }) which stamps a pending
 * phone / phone_change on the CALLER's auth.users row. GoTrue enforces
 * phone uniqueness across auth.users, so a stale unconfirmed claim on
 * account B would block account A from ever confirming its own (already
 * app-verified) number.
 *
 * The primary defense is ordering (src/lib/auth/phone-flow.ts checks
 * ownership BEFORE any provider call, so a rival attempt never reaches
 * updateUser). This sweep is the belt-and-braces repair: clear any
 * UNCONFIRMED auth.users phone/phone_change value that collides with a
 * number some OTHER account holds verified in the app User table.
 * Confirmed phones (phone_confirmed_at set) are never touched.
 *
 * NOTE: GoTrue stores phones without the leading '+'; User.phoneE164
 * keeps it - hence the '+' || concatenations.
 */
export async function cleanupStalePhoneClaims(): Promise<number> {
  try {
    const clearedPending = await db.$executeRaw`
      UPDATE auth.users au
      SET phone_change = '', phone_change_token = '', phone_change_sent_at = NULL
      WHERE COALESCE(au.phone_change, '') <> ''
        AND EXISTS (
          SELECT 1 FROM "User" u
          WHERE u."phoneE164" = '+' || au.phone_change
            AND u."phoneVerifiedAt" IS NOT NULL
            AND u.id <> au.id::text)`;
    const clearedUnconfirmed = await db.$executeRaw`
      UPDATE auth.users au
      SET phone = NULL
      WHERE au.phone IS NOT NULL
        AND au.phone_confirmed_at IS NULL
        AND EXISTS (
          SELECT 1 FROM "User" u
          WHERE u."phoneE164" = '+' || au.phone
            AND u."phoneVerifiedAt" IS NOT NULL
            AND u.id <> au.id::text)`;
    const total = clearedPending + clearedUnconfirmed;
    if (total > 0) {
      console.warn(
        `[auth:cleanup] cleared ${total} stale phone claim(s) from auth.users ` +
          `(${clearedPending} pending phone_change, ${clearedUnconfirmed} unconfirmed phone)`,
      );
      await recordAuthEvent({
        type: "phone_claim_cleanup",
        userId: null,
        metadata: { clearedPending, clearedUnconfirmed },
      });
    }
    return total;
  } catch (error) {
    console.error("[auth:cleanup] stale phone claim sweep failed:", error);
    return 0;
  }
}

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
