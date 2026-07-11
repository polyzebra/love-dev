import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import {
  gotruePhone,
  serviceRoleKeyPresent,
  syncVerifiedPhoneToAuth,
  type AdminPhoneSyncClient,
} from "@/lib/auth/phone-flow";

/**
 * Phone split-brain reconciliation between the app DB (source of truth,
 * User.phoneE164 + phoneVerifiedAt) and auth.users.phone (identity
 * mirror). Three honest categories, per the do-not-guess rule:
 *
 *  (a) app-verified but auth missing/mismatched -> REPAIRED via the
 *      service-role admin client, but only when unambiguous: the auth row
 *      for the SAME uid exists and no OTHER auth row holds the number.
 *      Every repair is audited (phone_auth_sync on the account timeline;
 *      AdminLog when an actor triggered the run).
 *  (b) auth.users.phone present with no matching app claim -> REPORT
 *      ONLY. An identity is never auto-stripped of a phone.
 *  (c) the number is held by a DIFFERENT auth row (or the uid has no auth
 *      row at all) -> QUARANTINE report, no auto-fix; the app row is
 *      stamped FAILED with an explanatory code so it stays visibly
 *      unreconciled in the admin panel.
 *
 * Runs only when the service-role key is present (or a client is
 * injected - tests); otherwise returns `configured: false` honestly and
 * touches nothing.
 */

export type PhoneReconcileReport = {
  configured: boolean;
  /** App rows with a verified phone that were examined. */
  scanned: number;
  /** Already consistent (auth.users.phone === phoneE164, GoTrue form). */
  consistent: number;
  repaired: { userId: string; phoneE164: string }[];
  repairFailed: { userId: string; phoneE164: string; errorCode: string }[];
  /** auth.users rows carrying a phone no app account claims - report only. */
  authOnly: { authUserId: string; phone: string }[];
  /** Split-brain the service refuses to auto-fix. */
  conflicts: { userId: string; phoneE164: string; reason: string; authHolderId: string | null }[];
};

export async function reconcilePhoneSync(opts?: {
  /** Structural admin client override (tests). */
  client?: AdminPhoneSyncClient;
  /** Staff actor for AdminLog attribution (admin route). Cron runs omit it. */
  actorId?: string;
  /**
   * Restrict reconciliation to these app user ids (tests / targeted runs).
   * The authOnly report still compares against ALL app claims, so scoping
   * never misreports someone else's number as unclaimed.
   */
  onlyUserIds?: string[];
  req?: Request;
}): Promise<PhoneReconcileReport> {
  const report: PhoneReconcileReport = {
    configured: Boolean(opts?.client) || serviceRoleKeyPresent(),
    scanned: 0,
    consistent: 0,
    repaired: [],
    repairFailed: [],
    authOnly: [],
    conflicts: [],
  };
  if (!report.configured) return report;

  // One read per store; all comparisons in GoTrue form (no leading '+').
  const allAppRows = await db.user.findMany({
    where: { phoneVerifiedAt: { not: null }, phoneE164: { not: null } },
    select: { id: true, phoneE164: true },
  });
  const appRows = opts?.onlyUserIds
    ? allAppRows.filter((r) => opts.onlyUserIds!.includes(r.id))
    : allAppRows;
  const authRows = await db.$queryRaw<{ id: string; phone: string | null }[]>`
    SELECT id::text, phone FROM auth.users`;
  const authPhoneByUid = new Map(authRows.map((r) => [r.id, r.phone ?? null]));
  const authUidByPhone = new Map<string, string>();
  for (const r of authRows) {
    if (r.phone && r.phone.length > 0) authUidByPhone.set(r.phone, r.id);
  }
  const appPhoneSet = new Set(allAppRows.map((r) => gotruePhone(r.phoneE164!)));

  for (const row of appRows) {
    const phoneE164 = row.phoneE164!;
    const expected = gotruePhone(phoneE164);
    report.scanned += 1;

    if (!authPhoneByUid.has(row.id)) {
      // App row without ANY auth identity - never repairable from here.
      report.conflicts.push({
        userId: row.id,
        phoneE164,
        reason: "auth_user_missing",
        authHolderId: null,
      });
      await markFailed(row.id, "auth_user_missing");
      continue;
    }
    const rival = authUidByPhone.get(expected);
    if (rival && rival !== row.id) {
      report.conflicts.push({
        userId: row.id,
        phoneE164,
        reason: "auth_phone_conflict",
        authHolderId: rival,
      });
      await markFailed(row.id, "auth_phone_conflict");
      continue;
    }
    if (authPhoneByUid.get(row.id) === expected) {
      report.consistent += 1;
      // Heal a stale disposition (e.g. FAILED from an outage that a later
      // path already fixed) without touching auth - state must tell the truth.
      await db.user.updateMany({
        where: { id: row.id, NOT: { phoneSyncStatus: "SYNCED" } },
        data: {
          phoneSyncStatus: "SYNCED",
          phoneSyncErrorCode: null,
          phoneSyncUpdatedAt: new Date(),
          authCompleted: true,
        },
      });
      continue;
    }

    // Unambiguous same-user repair: same uid, number unheld elsewhere.
    const result = await syncVerifiedPhoneToAuth({
      userId: row.id,
      phoneE164,
      client: opts?.client,
      req: opts?.req,
    });
    if (result.status === "SYNCED") {
      report.repaired.push({ userId: row.id, phoneE164 });
      if (opts?.actorId) {
        await audit({
          actorId: opts.actorId,
          action: "user.phone_sync_repair",
          targetType: "user",
          targetId: row.id,
          metadata: { phoneE164 },
        });
      }
    } else {
      report.repairFailed.push({
        userId: row.id,
        phoneE164,
        errorCode: result.errorCode ?? "unknown",
      });
    }
  }

  // (b) auth-side phones with no app claim - report only, never auto-clear.
  for (const [phone, uid] of authUidByPhone) {
    if (!appPhoneSet.has(phone)) report.authOnly.push({ authUserId: uid, phone });
  }

  return report;
}

/** Durable quarantine stamp - keeps the row visibly unreconciled. */
async function markFailed(userId: string, errorCode: string): Promise<void> {
  await db.user
    .updateMany({
      // updateMany so a concurrently-deleted row is a no-op, not a throw
      where: { id: userId },
      data: {
        phoneSyncStatus: "FAILED",
        phoneSyncErrorCode: errorCode,
        phoneSyncUpdatedAt: new Date(),
      },
    })
    .catch((error) => {
      console.error(`[phone-reconcile] failed to stamp ${userId}:`, error);
    });
}
