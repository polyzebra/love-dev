import type { User as SupabaseAuthUser } from "@supabase/supabase-js";
import { db } from "@/lib/db";
import { ipHashFrom, userAgentHashFrom } from "@/lib/auth/audit";
import { Prisma, type User as AppUser } from "@/generated/prisma/client";

/**
 * Identity rules - Supabase Auth (auth.users.id) is the ONLY identity.
 * The app User row is profile data whose lifecycle follows it. No code
 * anywhere may look an identity up by email (allowed exceptions:
 * password reset + email verification, which Supabase owns).
 */

/**
 * Does this uid still exist in Supabase Auth? Queried straight from
 * auth.users (same database) - never trust the app User row's email
 * alone. Fails SAFE: if auth.users is unreadable we report "alive" so
 * a live account is never torn down by mistake.
 */
export async function isAuthUserAlive(userId: string): Promise<boolean> {
  try {
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM auth.users WHERE id::text = ${userId} LIMIT 1`;
    return rows.length > 0;
  } catch (error) {
    console.warn(`[identity] auth.users lookup failed - assuming alive: ${String(error).slice(0, 80)}`);
    return true;
  }
}

/** Is this email banned from authenticating (any provider unless scoped)? */
export async function isIdentityBlocked(email: string, provider?: string): Promise<boolean> {
  const row = await db.blockedIdentity.findUnique({ where: { email: email.toLowerCase() } });
  if (!row) return false;
  if (row.expiresAt && row.expiresAt < new Date()) return false;
  if (row.provider && provider && row.provider !== provider) return false;
  return true;
}

/**
 * Industry-standard deletion model: profile data is deleted or
 * GDPR-anonymized immediately; the EMAIL IS FREED so the person may
 * register again later - as a completely new identity. Chats/matches
 * keep an anonymized shell until the retention job hard-deletes them
 * (deletionRequested drives the 30-day GDPR cleanup). Normal deletion
 * is NOT a ban: nothing is written to BlockedIdentity here.
 */
export async function teardownAccount(userId: string, reason: string): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return;
  const tombstone = `deleted+${userId}@tombstone.tirvea.app`;
  await db.$transaction([
    // Anonymized shell - identity gone, email freed for re-registration
    db.user.update({
      where: { id: userId },
      data: {
        status: "DELETED",
        email: user.email.startsWith("deleted+") ? user.email : tombstone,
        deletionRequested: new Date(),
        name: null,
        image: null,
        phone: null,
        phoneVerified: null,
        phoneE164: null,
        phoneCountryIso: null,
        phoneDialCode: null,
        phoneVerifiedAt: null,
        authCompleted: false,
      },
    }),
    // Hard-delete everything personal right away
    db.photo.deleteMany({ where: { userId } }),
    db.verification.deleteMany({ where: { userId } }),
    db.profile.deleteMany({ where: { userId } }),
    db.userExplorePreference.deleteMany({ where: { userId } }),
    db.device.deleteMany({ where: { userId } }),
    db.notification.deleteMany({ where: { userId } }),
    db.userSettings.deleteMany({ where: { userId } }),
  ]);
  // Best-effort storage cleanup: no user session exists here, so remove the
  // photo objects straight from storage.objects. Never let this break teardown.
  try {
    await db.$executeRaw`DELETE FROM storage.objects WHERE bucket_id = 'listing-images' AND name LIKE ${"users/" + userId + "/%"}`;
  } catch (error) {
    console.warn(`[identity] storage cleanup failed for ${userId}: ${String(error).slice(0, 120)}`);
  }
  console.info(`[identity] account ${userId} deleted (${reason}) - email freed`);
}

/**
 * A DELETED shell whose auth uid signs in again: remove the shell so
 * a brand-new account can be created under the same auth uid. Chats/
 * matches attached to the shell fall away with it (cascade) - nothing
 * from the old life reconnects.
 */
export async function recycleDeletedRow(userId: string): Promise<void> {
  await db.user.delete({ where: { id: userId } }).catch(() => {});
  console.info(`[identity] deleted shell ${userId} recycled for fresh registration`);
}

export type EnsureAppUserResult =
  | { ok: true; user: AppUser; created: boolean; previousLoginIpHash: string | null }
  | { ok: false; reason: "blocked" | "suspended" | "conflict" };

/**
 * THE single app-User provisioning path. Both the OAuth/magic-link
 * callback and the email-OTP verify route funnel through here, so the
 * identity rules exist exactly once:
 * - blocked identities never get an app row
 * - bans stay banned; a DELETED shell is recycled into a fresh account
 * - DEACTIVATED (grace-window deletion) is cancelled by signing in
 * - one email = one account; conflicts are rejected, never merged
 *
 * The CALLER owns the Supabase session (sign-out on rejection) - this
 * function only decides and records.
 */
export async function ensureAppUser(
  u: SupabaseAuthUser,
  opts?: { req?: Request },
): Promise<EnsureAppUserResult> {
  const email = u.email!.toLowerCase();
  const provider = (u.app_metadata?.provider as string | undefined) ?? "email";

  const loginStamps = {
    lastLoginAt: new Date(),
    lastLoginIpHash: opts?.req ? ipHashFrom(opts.req) : null,
    lastUserAgentHash: opts?.req ? userAgentHashFrom(opts.req) : null,
  };

  // Blocklist gate - a blocked identity never gets (or keeps) an app row
  if (await isIdentityBlocked(email, provider)) {
    return { ok: false, reason: "blocked" };
  }

  const existing = await db.user.findUnique({ where: { id: u.id } });
  if (existing) {
    // Bans stay banned - but normal deletion is NOT a ban
    if (existing.status === "SUSPENDED" || existing.bannedAt) {
      return { ok: false, reason: "suspended" };
    }
    if (existing.status === "DELETED") {
      // Tinder-style re-registration: drop the anonymized shell and
      // fall through to a completely fresh account (same auth uid,
      // zero history - onboarding starts from scratch)
      await recycleDeletedRow(existing.id);
    } else {
      // DEACTIVATED = in-app deletion within the grace window:
      // signing in cancels it, as promised at deletion time
      const updated = await db.user.update({
        where: { id: u.id },
        data: {
          email,
          lastActiveAt: new Date(),
          ...loginStamps,
          ...(u.email_confirmed_at && !existing.emailVerified
            ? { emailVerified: new Date(u.email_confirmed_at) }
            : {}),
          ...(existing.status === "DEACTIVATED"
            ? { status: "ACTIVE", deletionRequested: null }
            : {}),
        },
      });
      return {
        ok: true,
        user: updated,
        created: false,
        previousLoginIpHash: existing.lastLoginIpHash,
      };
    }
  }

  // New identity. If a DELETED row still holds this email, tombstone it
  // first - the new account starts empty. An ACTIVE row holding it under
  // a different auth id is an integrity conflict: never merge.
  const emailHolder = await db.user.findUnique({ where: { email } });
  if (emailHolder) {
    if (emailHolder.status === "DELETED") {
      await teardownAccount(emailHolder.id, "email freed for new identity");
    } else if (!(await isAuthUserAlive(emailHolder.id))) {
      // The holder's auth user is gone (dashboard deletion without the
      // webhook) - it's an orphan, not a conflict. Tear it down, free
      // the email, and let the new identity start from zero.
      await teardownAccount(emailHolder.id, "orphaned by auth-user deletion");
    } else {
      console.error(
        `[identity] conflict: email held by LIVE account ${emailHolder.id}, new auth uid ${u.id}`,
      );
      return { ok: false, reason: "conflict" };
    }
  }

  let createdUser: AppUser;
  try {
    createdUser = await db.user.create({
      data: {
        id: u.id,
        email,
        emailVerified: u.email_confirmed_at ? new Date(u.email_confirmed_at) : null,
        name: (u.user_metadata?.full_name as string | undefined) ?? null,
        image: (u.user_metadata?.avatar_url as string | undefined) ?? null,
        ...loginStamps,
      },
    });
  } catch (error) {
    // Concurrent FIRST logins for one uid (double-delivered callback,
    // OTP verify racing the callback): the PK settles it - exactly one
    // row. The loser adopts the winner's row instead of erroring.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const winner = await db.user.findUnique({ where: { id: u.id } });
      if (winner) {
        console.info(`[identity] first-login race for auth.uid=${u.id} - adopting winner row`);
        return { ok: true, user: winner, created: false, previousLoginIpHash: null };
      }
    }
    throw error;
  }
  console.info(`[identity] new account auth.uid=${u.id} provider=${provider}`);
  return { ok: true, user: createdUser, created: true, previousLoginIpHash: null };
}
