import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { recordAuthEvent } from "@/lib/auth/audit";
import { maskPhone } from "@/lib/phone-mask";
import { gotruePhone } from "@/lib/auth/phone-flow";
import { applyDirectAction, clearBanCredentials } from "@/lib/services/trust-safety";

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

/**
 * Human-decided ban. Since the trust & safety milestone this writes the
 * FULL enforcement picture, not just the User columns:
 *  - status BANNED (was SUSPENDED before the ladder existed) + bannedAt
 *  - an AccountViolation (actionTaken BANNED, appealable) so the appeals
 *    surface has something to attach to
 *  - the ban-evasion credential snapshot (verified phone + device hash)
 *  - the SAFETY notice through the notification outbox
 * Existing behavior preserved: gate -> /account-blocked, login flows keep
 * rejecting (they check bannedAt, which is still stamped).
 */
export async function banUser(opts: {
  actorId: string;
  userId: string;
  reason: string;
  req?: Request;
}): Promise<void> {
  const outcome = await applyDirectAction({
    userId: opts.userId,
    violationType: "OTHER",
    action: "BANNED",
    internalReason: `admin ban by ${opts.actorId}: ${opts.reason}`,
    userVisibleReason: opts.reason,
  });
  const user = await db.user.findUniqueOrThrow({
    where: { id: opts.userId },
    select: { email: true },
  });
  await audit({
    actorId: opts.actorId,
    action: "user.ban",
    targetType: "user",
    targetId: opts.userId,
    metadata: { reason: opts.reason, violationId: outcome.violationId },
  });
  await recordAuthEvent({
    type: "admin_ban",
    userId: opts.userId,
    email: user.email,
    req: opts.req,
    metadata: { actorId: opts.actorId, reason: opts.reason, violationId: outcome.violationId },
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
  // Reverse the ban's enforcement footprint: open BANNED violations and
  // the ban-evasion credential snapshot (phone/device may sign in again).
  await db.accountViolation.updateMany({
    where: { userId: opts.userId, actionTaken: "BANNED", reversedAt: null },
    data: { reversedAt: new Date() },
  });
  await clearBanCredentials(opts.userId);
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

// ---------------------------------------------------------------------------
// Release from a DELETED/orphaned account (supers only at the route level)
// ---------------------------------------------------------------------------

export type PhoneReleaseAbortCode =
  /** Nobody holds the number (already released, or it never verified). */
  | "holder_not_found"
  /** The number is held by a DIFFERENT account than expectedOldUserId. */
  | "holder_mismatch"
  /** The holder is a LIVE account (not DELETED, auth.users row exists). */
  | "holder_active"
  /** newOwnerUserId does not exist / is not email-verified / is the holder. */
  | "invalid_new_owner"
  /** The holder row changed between the caller's read and our lock. */
  | "concurrent_change";

/** Typed abort for releaseDeletedUserPhone - every ambiguity refuses loudly. */
export class PhoneReleaseError extends Error {
  readonly code: PhoneReleaseAbortCode;
  constructor(code: PhoneReleaseAbortCode, message: string) {
    super(message);
    this.name = "PhoneReleaseError";
    this.code = code;
  }
}

export type AuthPhoneClearOutcome =
  /** auth.users.phone matched and was cleared. */
  | "cleared"
  /** No auth.users row holds the number (usual: the auth user is gone). */
  | "not_needed"
  /** A DIFFERENT auth identity holds the number - never touched here;
   *  the reconciliation service reports auth-only holders. */
  | "foreign_auth_holder"
  /** The clear attempt failed - recorded for reconciliation/re-run. */
  | "pending";

type LockedHolderRow = {
  id: string;
  status: string;
  phoneE164: string | null;
  phoneDialCode: string | null;
};

/**
 * Release a phone number from an account that is conclusively NOT alive:
 * status DELETED, or its auth.users row is gone (dashboard deletion that
 * left the app row behind - the known orphan class). This is the safe
 * counterpart of releasePhone (which stays for LIVE accounts).
 *
 * Guarantees:
 *  - transactional: the holder row is locked (SELECT ... FOR UPDATE), so a
 *    concurrent claim/release loses deterministically;
 *  - aborts with a typed PhoneReleaseError on EVERY ambiguity - holder
 *    mismatch, live holder, concurrent change, invalid new owner. It never
 *    guesses and NEVER merges accounts;
 *  - NEVER attaches: `newOwnerUserId` is only validated (exists +
 *    email-verified). The number reaches the new owner exclusively through
 *    the normal fresh-OTP verification flow (phone-flow.ts);
 *  - clears ONLY the phone columns - audit rows, messages, photos and the
 *    holder row itself are preserved untouched;
 *  - mirrors the release into auth.users.phone for the SAME identity when
 *    a row still holds it. GoTrue's admin API cannot NULL a phone (empty
 *    string is treated as "not provided"), so the clear is a direct
 *    same-database UPDATE - consistent with teardownAccount's
 *    storage.objects cleanup. Failures are recorded as `pending` in the
 *    audit metadata, never thrown;
 *  - writes AdminLog "admin.phone.release-deleted" (masked number only)
 *    + an AuthVerificationEvent on the old owner's timeline.
 */
export async function releaseDeletedUserPhone(opts: {
  phoneE164: string;
  expectedOldUserId: string;
  /** Intended next owner - VALIDATED ONLY, never attached here. */
  newOwnerUserId?: string;
  reason: string;
  actorId: string;
  /** Free-text context for the audit trail (e.g. "system/bootstrap"). */
  actorContext?: string;
  req?: Request;
}): Promise<{
  released: string;
  oldOwnerId: string;
  newOwnerId: string | null;
  authPhoneCleared: AuthPhoneClearOutcome;
}> {
  const { phoneE164, expectedOldUserId, reason } = opts;

  // New-owner validation (existence + verified email). Attachment itself
  // MUST go through a fresh OTP - this function has no attach path.
  let newOwnerId: string | null = null;
  if (opts.newOwnerUserId) {
    if (opts.newOwnerUserId === expectedOldUserId) {
      throw new PhoneReleaseError(
        "invalid_new_owner",
        "The new owner must be a different account than the released holder.",
      );
    }
    const candidate = await db.user.findUnique({
      where: { id: opts.newOwnerUserId },
      select: { id: true, emailVerified: true, status: true },
    });
    if (!candidate || candidate.status === "DELETED" || !candidate.emailVerified) {
      throw new PhoneReleaseError(
        "invalid_new_owner",
        "The intended new owner must exist and hold a verified email.",
      );
    }
    newOwnerId = candidate.id;
  }

  const dialCode = await db.$transaction(async (tx) => {
    // Lock the holder row. FOR UPDATE serializes this release against a
    // concurrent verify/claim/release touching the same row.
    const holders = await tx.$queryRaw<LockedHolderRow[]>`
      SELECT id, status, "phoneE164", "phoneDialCode"
      FROM public."User"
      WHERE "phoneE164" = ${phoneE164}
      FOR UPDATE`;
    const holder = holders[0];

    if (!holder) {
      // Distinguish "already released/changed" from "never held".
      const expected = await tx.user.findUnique({
        where: { id: expectedOldUserId },
        select: { id: true },
      });
      if (expected) {
        throw new PhoneReleaseError(
          "concurrent_change",
          "The expected holder no longer carries this number - nothing was changed.",
        );
      }
      throw new PhoneReleaseError(
        "holder_not_found",
        "No account holds this number - nothing to release.",
      );
    }
    if (holder.id !== expectedOldUserId) {
      throw new PhoneReleaseError(
        "holder_mismatch",
        "The number is held by a different account than expected - nothing was changed.",
      );
    }

    // Aliveness, decided INSIDE the lock window. A holder is releasable
    // only when it is conclusively not a live account: tombstoned
    // (status DELETED) or its auth.users identity is gone. The auth read
    // fails SAFE: if auth.users is unreadable we treat the holder as
    // alive and abort (same fail-safe stance as isAuthUserAlive).
    if (holder.status !== "DELETED") {
      let authAlive = true;
      try {
        const rows = await tx.$queryRaw<{ id: string }[]>`
          SELECT id::text FROM auth.users WHERE id::text = ${holder.id} LIMIT 1`;
        authAlive = rows.length > 0;
      } catch (error) {
        console.warn(
          `[admin:phone-release] auth.users lookup failed - assuming alive: ${String(error).slice(0, 80)}`,
        );
        authAlive = true;
      }
      if (authAlive) {
        throw new PhoneReleaseError(
          "holder_active",
          "The holder is a live account. Use the regular release for live accounts, or let the owner decide.",
        );
      }
    }

    // The release itself: phone columns only. Everything else on the row
    // (audit trail, messages, photos, role, status) is preserved.
    await tx.user.update({
      where: { id: holder.id },
      data: {
        phone: null,
        phoneVerified: null,
        phoneE164: null,
        phoneCountryIso: null,
        phoneDialCode: null,
        phoneVerifiedAt: null,
        phoneSyncStatus: null,
        phoneSyncErrorCode: null,
        phoneSyncUpdatedAt: null,
      },
    });
    return holder.phoneDialCode;
  });

  // Mirror: clear auth.users.phone for the SAME identity if a row still
  // holds the number (in-database UPDATE - see the docblock for why the
  // admin API cannot do this). A foreign auth identity holding the number
  // is never touched - reported via metadata for reconciliation.
  let authPhoneCleared: AuthPhoneClearOutcome = "not_needed";
  let foreignAuthHolder: string | null = null;
  try {
    const bare = gotruePhone(phoneE164);
    const authHolders = await db.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM auth.users WHERE phone = ${bare} OR phone = ${phoneE164}`;
    if (authHolders.length > 0) {
      if (authHolders.some((r) => r.id === expectedOldUserId)) {
        await db.$executeRaw`
          UPDATE auth.users
          SET phone = NULL, phone_confirmed_at = NULL, updated_at = NOW()
          WHERE id::text = ${expectedOldUserId}
            AND (phone = ${bare} OR phone = ${phoneE164})`;
        authPhoneCleared = "cleared";
      } else {
        authPhoneCleared = "foreign_auth_holder";
        foreignAuthHolder = authHolders[0].id;
      }
    }
  } catch (error) {
    console.warn(
      `[admin:phone-release] auth.users.phone clear failed - recorded as pending: ${String(error).slice(0, 120)}`,
    );
    authPhoneCleared = "pending";
  }

  const maskedPhone = maskPhone(phoneE164, dialCode);
  await audit({
    actorId: opts.actorId,
    action: "admin.phone.release-deleted",
    targetType: "user",
    targetId: expectedOldUserId,
    metadata: {
      oldOwner: expectedOldUserId,
      ...(newOwnerId ? { newOwner: newOwnerId } : {}),
      maskedPhone,
      reason,
      authPhoneCleared,
      ...(foreignAuthHolder ? { foreignAuthHolder } : {}),
      ...(opts.actorContext ? { actorContext: opts.actorContext } : {}),
    },
  });
  await recordAuthEvent({
    type: "admin_release_deleted_phone",
    userId: expectedOldUserId,
    phoneE164,
    req: opts.req,
    metadata: {
      actorId: opts.actorId,
      oldOwner: expectedOldUserId,
      ...(newOwnerId ? { newOwner: newOwnerId } : {}),
      reason,
      authPhoneCleared,
      ...(opts.actorContext ? { actorContext: opts.actorContext } : {}),
    },
  });

  return { released: phoneE164, oldOwnerId: expectedOldUserId, newOwnerId, authPhoneCleared };
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
