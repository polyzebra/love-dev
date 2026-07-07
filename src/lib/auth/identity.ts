import { db } from "@/lib/db";

/**
 * Identity rules - Supabase Auth (auth.users.id) is the ONLY identity.
 * The app User row is profile data whose lifecycle follows it. No code
 * anywhere may look an identity up by email (allowed exceptions:
 * password reset + email verification, which Supabase owns).
 */

/** Is this email banned from authenticating (any provider unless scoped)? */
export async function isIdentityBlocked(email: string, provider?: string): Promise<boolean> {
  const row = await db.blockedIdentity.findUnique({ where: { email: email.toLowerCase() } });
  if (!row) return false;
  if (row.expiresAt && row.expiresAt < new Date()) return false;
  if (row.provider && provider && row.provider !== provider) return false;
  return true;
}

/**
 * Full account teardown for an auth-user deletion. Marks the row
 * DELETED, frees the email with a tombstone (so a future signup is a
 * genuinely NEW account - never resurrection), hides the profile and
 * clears device/push state. GDPR hard-delete rides deletionRequested.
 */
export async function teardownAccount(userId: string, reason: string): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return;
  const tombstone = `deleted+${userId}@tombstone.virelsy.app`;
  await db.$transaction([
    db.user.update({
      where: { id: userId },
      data: {
        status: "DELETED",
        email: user.email.startsWith("deleted+") ? user.email : tombstone,
        deletionRequested: new Date(),
        name: null,
        image: null,
      },
    }),
    db.profile.updateMany({ where: { userId }, data: { isVisible: false } }),
    db.device.deleteMany({ where: { userId } }),
    db.notification.deleteMany({ where: { userId } }),
  ]);
  console.info(`[identity] account ${userId} torn down (${reason})`);
}
