import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { recordAuthEvent } from "@/lib/auth/audit";

/**
 * Admin trust actions on a user account. Every action here:
 *  1. writes the User fields,
 *  2. mirrors to AdminLog (audit) so staff activity is reviewable,
 *  3. records an AuthVerificationEvent so the account's own auth
 *     timeline shows what happened to it and when.
 *
 * Routes own the permission checks (requirePermission) - these functions
 * own the mutations, so they are directly exercisable by tests.
 */

export async function banUser(opts: {
  actorId: string;
  userId: string;
  reason: string;
  req?: Request;
}): Promise<void> {
  const user = await db.user.update({
    where: { id: opts.userId },
    data: { bannedAt: new Date(), banReason: opts.reason, status: "SUSPENDED" },
    select: { email: true },
  });
  await audit({
    actorId: opts.actorId,
    action: "user.ban",
    targetType: "user",
    targetId: opts.userId,
    metadata: { reason: opts.reason },
  });
  await recordAuthEvent({
    type: "admin_ban",
    userId: opts.userId,
    email: user.email,
    req: opts.req,
    metadata: { actorId: opts.actorId, reason: opts.reason },
  });
}

export async function unbanUser(opts: {
  actorId: string;
  userId: string;
  req?: Request;
}): Promise<void> {
  const user = await db.user.update({
    where: { id: opts.userId },
    data: { bannedAt: null, banReason: null, status: "ACTIVE" },
    select: { email: true },
  });
  await audit({
    actorId: opts.actorId,
    action: "user.unban",
    targetType: "user",
    targetId: opts.userId,
  });
  await recordAuthEvent({
    type: "admin_unban",
    userId: opts.userId,
    email: user.email,
    req: opts.req,
    metadata: { actorId: opts.actorId },
  });
}

/**
 * Free the phone number so it can verify a different account. Clears the
 * legacy `phone` column too - both carry unique constraints.
 */
export async function releasePhone(opts: {
  actorId: string;
  userId: string;
  req?: Request;
}): Promise<{ released: string | null }> {
  const before = await db.user.findUniqueOrThrow({
    where: { id: opts.userId },
    select: { email: true, phone: true, phoneE164: true },
  });
  const released = before.phoneE164 ?? before.phone;
  await db.user.update({
    where: { id: opts.userId },
    data: {
      phone: null,
      phoneVerified: null,
      phoneE164: null,
      phoneCountryIso: null,
      phoneDialCode: null,
      phoneVerifiedAt: null,
      // The sync disposition travels with the number. NOTE: this frees the
      // APP claim only - a previously SYNCED auth.users.phone stays behind
      // (no service key required here); the reconciliation service reports
      // such auth-only numbers rather than auto-clearing an identity.
      phoneSyncStatus: null,
      phoneSyncErrorCode: null,
      phoneSyncUpdatedAt: null,
    },
  });
  await audit({
    actorId: opts.actorId,
    action: "user.release_phone",
    targetType: "user",
    targetId: opts.userId,
    metadata: { phoneE164: released },
  });
  await recordAuthEvent({
    type: "admin_release_phone",
    userId: opts.userId,
    email: before.email,
    phoneE164: released,
    req: opts.req,
    metadata: { actorId: opts.actorId },
  });
  return { released };
}

/**
 * "Release email" = lift the identity blocklist entry for this user's
 * email (see isIdentityBlocked in src/lib/auth/identity.ts). Only
 * meaningful alongside a ban - a BlockedIdentity row is what stops the
 * email from ever authenticating again. No-op when no row exists.
 */
export async function releaseEmail(opts: {
  actorId: string;
  userId: string;
  req?: Request;
}): Promise<{ removed: boolean }> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: opts.userId },
    select: { email: true },
  });
  const email = user.email.toLowerCase();
  const row = await db.blockedIdentity.findUnique({ where: { email } });
  if (row) await db.blockedIdentity.delete({ where: { email } });
  await audit({
    actorId: opts.actorId,
    action: "user.release_email",
    targetType: "user",
    targetId: opts.userId,
    metadata: { email, removed: row != null },
  });
  await recordAuthEvent({
    type: "admin_release_email",
    userId: opts.userId,
    email,
    req: opts.req,
    metadata: { actorId: opts.actorId, removed: row != null },
  });
  return { removed: row != null };
}

/** Force the phone step to run again on next sign-in (keeps the number). */
export async function requirePhoneReverification(opts: {
  actorId: string;
  userId: string;
  req?: Request;
}): Promise<void> {
  const user = await db.user.update({
    where: { id: opts.userId },
    data: { phoneVerifiedAt: null, authCompleted: false },
    select: { email: true, phoneE164: true },
  });
  await audit({
    actorId: opts.actorId,
    action: "user.require_phone_reverification",
    targetType: "user",
    targetId: opts.userId,
  });
  await recordAuthEvent({
    type: "admin_phone_reverify_required",
    userId: opts.userId,
    email: user.email,
    phoneE164: user.phoneE164,
    req: opts.req,
    metadata: { actorId: opts.actorId },
  });
}

/** Send the user back through onboarding on next visit. */
export async function resetOnboarding(opts: {
  actorId: string;
  userId: string;
  req?: Request;
}): Promise<void> {
  const user = await db.user.update({
    where: { id: opts.userId },
    data: { onboardingDone: false },
    select: { email: true },
  });
  await audit({
    actorId: opts.actorId,
    action: "user.reset_onboarding",
    targetType: "user",
    targetId: opts.userId,
  });
  await recordAuthEvent({
    type: "admin_reset_onboarding",
    userId: opts.userId,
    email: user.email,
    req: opts.req,
    metadata: { actorId: opts.actorId },
  });
}
