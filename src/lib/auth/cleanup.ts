import { db } from "@/lib/db";
import { recordAuthEvent } from "@/lib/auth/audit";
import {
  isPhoneVerificationEnabled,
  resolveRegistrationState,
  type GateUser,
  type RegistrationState,
} from "@/lib/auth/gate";

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

/**
 * Abandoned-registration sweeper (L7.3.8). Deletes PENDING app accounts that
 * stalled mid-registration, by how far they got - matching the policy:
 *   EMAIL_PENDING / PHONE_PENDING -> 24h
 *   LEGAL_PENDING                 -> 48h
 *   ONBOARDING_PENDING            -> 7 days
 *
 * SAFETY (fail-safe, never over-deletes):
 *  - Only status='PENDING' with registrationCompletedAt IS NULL is considered;
 *    an ACTIVE (or any activated) account is NEVER a candidate.
 *  - Any account with a subscription row or any payment is skipped outright.
 *  - The final deleteMany re-asserts status='PENDING' AND registrationCompletedAt
 *    IS NULL, so an account that completes registration between the scan and the
 *    delete is not removed (no race).
 *  - App-row delete cascades app data; the matching auth.users row is then
 *    removed (cascades auth sessions/identities), best-effort.
 */
const ABANDON_THRESHOLD_HOURS: Partial<Record<RegistrationState, number>> = {
  EMAIL_PENDING: 24,
  PHONE_PENDING: 24,
  LEGAL_PENDING: 48,
  ONBOARDING_PENDING: 24 * 7,
};

export async function cleanupAbandonedRegistrations(now: Date = new Date()): Promise<number> {
  try {
    const phoneEnabled = isPhoneVerificationEnabled();
    const candidates = await db.user.findMany({
      where: { status: "PENDING", registrationCompletedAt: null },
      select: {
        id: true,
        status: true,
        bannedAt: true,
        email: true,
        emailVerified: true,
        phoneVerifiedAt: true,
        ageConfirmedAt: true,
        termsVersion: true,
        privacyVersion: true,
        communityVersion: true,
        onboardingDone: true,
        registrationStartedAt: true,
        createdAt: true,
        // Billing guard: never delete anyone who has ever paid/subscribed.
        subscription: { select: { id: true } },
        _count: { select: { payments: true } },
      },
    });

    const toDelete: string[] = [];
    for (const u of candidates) {
      if (u.subscription || u._count.payments > 0) continue;
      const state = resolveRegistrationState(u as GateUser, phoneEnabled);
      const hours = ABANDON_THRESHOLD_HOURS[state];
      if (!hours) continue; // ACTIVE/BLOCKED/CANCELLED are never swept here
      const started = u.registrationStartedAt ?? u.createdAt;
      const ageHours = (now.getTime() - started.getTime()) / 3_600_000;
      if (ageHours >= hours) toDelete.push(u.id);
    }
    if (toDelete.length === 0) return 0;

    // Re-assert PENDING + not-completed in the delete: an account that finished
    // registration since the scan is protected.
    const removed = await db.user.deleteMany({
      where: { id: { in: toDelete }, status: "PENDING", registrationCompletedAt: null },
    });
    for (const id of toDelete) {
      await db.$executeRaw`DELETE FROM auth.users WHERE id::text = ${id}`.catch(() => {});
    }
    await recordAuthEvent({
      type: "auth_cleanup",
      userId: null,
      metadata: { kind: "abandoned_registration", count: removed.count },
    });
    return removed.count;
  } catch (error) {
    console.error("[auth:cleanup] abandoned-registration sweep failed:", error);
    return 0;
  }
}
