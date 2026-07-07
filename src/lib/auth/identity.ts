import { db } from "@/lib/db";

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
 * Tinder-style account deletion: profile data is deleted or
 * GDPR-anonymized immediately; the EMAIL IS FREED so the person may
 * register again later - as a completely new identity. Chats/matches
 * keep an anonymized shell until the retention job hard-deletes them
 * (deletionRequested drives the 30-day GDPR cleanup). Normal deletion
 * is NOT a ban: nothing is written to BlockedIdentity here.
 */
export async function teardownAccount(userId: string, reason: string): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return;
  const tombstone = `deleted+${userId}@tombstone.virelsy.app`;
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
      },
    }),
    // Hard-delete everything personal right away
    db.photo.deleteMany({ where: { userId } }),
    db.verification.deleteMany({ where: { userId } }),
    db.profile.deleteMany({ where: { userId } }),
    db.userExplorePreference.deleteMany({ where: { userId } }),
    db.device.deleteMany({ where: { userId } }),
    db.notification.deleteMany({ where: { userId } }),
  ]);
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
