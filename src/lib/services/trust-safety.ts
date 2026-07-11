import { db } from "@/lib/db";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type {
  AccountStatus,
  CaseSeverity,
  CaseSource,
  EnforcementAction,
  ModerationCaseType,
} from "@/generated/prisma/enums";
import { recordAuthEvent } from "@/lib/auth/audit";
import { sendSafetyNotice } from "@/lib/services/safety-notices";

/**
 * Trust & safety enforcement backbone - THE single source for:
 *  - account status ladder semantics (who is visible / may engage / may
 *    upload) - discovery/explore/swipes/chat all read the predicates here
 *  - moderation cases (open/dedupe/resolve)
 *  - graduated enforcement (warning -> photo removed -> upload blocked ->
 *    limited -> suspended; NEVER an automated ban)
 *  - violation reversal (approved appeals / admin reinstatement)
 *  - ban-evasion credential blocklist (verified phone + salted device hash)
 *
 * Design invariants:
 *  - every decision is server-side; nothing here is importable by clients
 *  - irreversible/severe actions (ban) are HUMAN-only: automation maxes out
 *    at SUSPENDED with an urgent CRITICAL case for a person to confirm
 *  - automated actions are audited via ModerationCase/AccountViolation rows
 *    + AuthVerificationEvent (AdminLog requires a human actor and is used
 *    only by admin-initiated paths)
 */

type DbClient = PrismaClient | Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Status ladder predicates (single source - see AccountStatus in the schema)
// ---------------------------------------------------------------------------

/** Statuses whose profiles stay visible in discovery/explore/likes. */
export const DISCOVERABLE_STATUSES = [
  "ACTIVE",
  "LIMITED",
  "PHOTO_REVIEW_REQUIRED",
] as const satisfies readonly AccountStatus[];

/** No app access at all - the gate routes these to the status area. */
export const RESTRICTED_STATUSES = ["SUSPENDED", "BANNED"] as const satisfies readonly AccountStatus[];

export function isDiscoverableStatus(status: string): boolean {
  return (DISCOVERABLE_STATUSES as readonly string[]).includes(status);
}

/** Suspended/banned - no sessions past the gate, 403 on every API. */
export function isRestrictedStatus(status: string): boolean {
  return (RESTRICTED_STATUSES as readonly string[]).includes(status);
}

/**
 * May this account SEND likes / first messages / chat messages?
 * LIMITED keeps read access but loses outbound engagement.
 */
export function canEngage(status: string): boolean {
  return status === "ACTIVE" || status === "PHOTO_REVIEW_REQUIRED";
}

/** Prisma where-fragment for "candidate is visible" user filters. */
export const DISCOVERABLE_USER_WHERE = {
  status: { in: [...DISCOVERABLE_STATUSES] },
} as const satisfies Prisma.UserWhereInput;

// ---------------------------------------------------------------------------
// Upload gating
// ---------------------------------------------------------------------------

export type UploadGate =
  | { ok: true }
  | { ok: false; code: "account_restricted" | "photo_review_required" | "upload_blocked"; message: string };

/**
 * May this user upload a new photo right now? Blocked while suspended/
 * banned/limited, while status is PHOTO_REVIEW_REQUIRED, or while an
 * unexpired UPLOAD_BLOCKED violation is active. Called by POST /api/photos
 * before any processing.
 */
export async function assertUploadAllowed(userId: string): Promise<UploadGate> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { status: true },
  });
  if (!user || isRestrictedStatus(user.status) || user.status === "LIMITED") {
    return {
      ok: false,
      code: "account_restricted",
      message: "Photo uploads are paused on your account. Check your account status for details.",
    };
  }
  if (user.status === "PHOTO_REVIEW_REQUIRED") {
    return {
      ok: false,
      code: "photo_review_required",
      message: "Please complete photo verification before adding new photos.",
    };
  }
  const now = new Date();
  const blocked = await db.accountViolation.findFirst({
    where: {
      userId,
      actionTaken: "UPLOAD_BLOCKED",
      reversedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { id: true },
  });
  if (blocked) {
    return {
      ok: false,
      code: "upload_blocked",
      message: "New photo uploads are paused on your account for now.",
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Moderation cases
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<CaseSeverity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

export type OpenCaseInput = {
  userId: string;
  caseType: ModerationCaseType;
  severity: CaseSeverity;
  source: CaseSource;
  summary: string;
  confidence?: number | null;
  /** PII-stripped structured evidence (photo ids, score snapshots, report ids). */
  evidence?: Prisma.InputJsonValue;
  photoId?: string | null;
  reportId?: string | null;
};

export type OpenCaseResult = { caseId: string; deduped: boolean };

/**
 * Open a moderation case, deduping against an existing OPEN/UNDER_REVIEW
 * case for the same (user, caseType): the new signal is appended to the
 * open case's evidence trail and severity only ever escalates. Same
 * status-dependent-uniqueness pattern as FirstMessage (service-enforced
 * inside a transaction - cannot be a @@unique).
 */
export async function openModerationCase(
  input: OpenCaseInput,
  client: DbClient = db,
): Promise<OpenCaseResult> {
  const run = async (tx: DbClient): Promise<OpenCaseResult> => {
    const existing = await tx.moderationCase.findFirst({
      where: {
        userId: input.userId,
        caseType: input.caseType,
        status: { in: ["OPEN", "UNDER_REVIEW"] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, severity: true, evidence: true },
    });
    if (existing) {
      const prior = Array.isArray(existing.evidence) ? existing.evidence : [existing.evidence ?? {}];
      const escalate = SEVERITY_RANK[input.severity] > SEVERITY_RANK[existing.severity];
      await tx.moderationCase.update({
        where: { id: existing.id },
        data: {
          ...(escalate ? { severity: input.severity } : {}),
          ...(input.confidence != null ? { confidence: input.confidence } : {}),
          evidence: [
            ...prior,
            {
              at: new Date().toISOString(),
              summary: input.summary,
              ...(input.photoId ? { photoId: input.photoId } : {}),
              ...(input.reportId ? { reportId: input.reportId } : {}),
              ...(input.evidence !== undefined ? { detail: input.evidence } : {}),
            },
          ] as Prisma.InputJsonValue,
        },
      });
      return { caseId: existing.id, deduped: true };
    }
    const created = await tx.moderationCase.create({
      data: {
        userId: input.userId,
        caseType: input.caseType,
        severity: input.severity,
        source: input.source,
        summary: input.summary,
        confidence: input.confidence ?? null,
        evidence: [
          {
            at: new Date().toISOString(),
            summary: input.summary,
            ...(input.photoId ? { photoId: input.photoId } : {}),
            ...(input.reportId ? { reportId: input.reportId } : {}),
            ...(input.evidence !== undefined ? { detail: input.evidence } : {}),
          },
        ] as Prisma.InputJsonValue,
        photoId: input.photoId ?? null,
        reportId: input.reportId ?? null,
      },
      select: { id: true },
    });
    return { caseId: created.id, deduped: false };
  };
  // Reuse the caller's transaction when given one; otherwise open our own.
  if (client === db) return db.$transaction((tx) => run(tx));
  return run(client);
}

/**
 * A photo was deleted (by its owner) while cases referenced it: auto-resolve
 * any still-open case whose subject was exactly that photo. Cases with
 * broader evidence stay open for a human.
 */
export async function resolveCasesForDeletedPhoto(photoId: string): Promise<number> {
  const result = await db.moderationCase.updateMany({
    where: { photoId, status: { in: ["OPEN", "UNDER_REVIEW"] } },
    data: {
      status: "DISMISSED",
      decisionReason: "Photo was deleted by its owner before review - nothing left to moderate.",
      reviewedAt: new Date(),
    },
  });
  return result.count;
}

// ---------------------------------------------------------------------------
// User-visible copy (calm, legally safe - the ONLY reason text users see)
// ---------------------------------------------------------------------------

export function userVisibleCopyFor(action: EnforcementAction): {
  reason: string;
  consequence: string;
} {
  switch (action) {
    case "WARNING":
      return {
        reason: "Something on your profile didn't follow our Community Guidelines.",
        consequence: "No action is needed right now. Repeated issues can limit your account.",
      };
    case "PHOTO_REMOVED":
      return {
        reason: "One of your photos didn't follow our Community Guidelines.",
        consequence: "The photo has been removed. You can add a different photo any time.",
      };
    case "UPLOAD_BLOCKED":
      return {
        reason: "Recent photos on your profile didn't follow our Community Guidelines.",
        consequence: "New photo uploads are paused for a short period.",
      };
    case "LIMITED":
      return {
        reason: "Recent activity on your account didn't follow our Community Guidelines.",
        consequence: "Sending likes and messages is paused for a short period.",
      };
    case "SUSPENDED":
      return {
        reason: "Your account is suspended while our team reviews recent activity.",
        consequence: "You can't use Tirvea during the review. A person will look at your account.",
      };
    case "BANNED":
      return {
        reason: "Your account was closed for activity that goes against our Community Guidelines.",
        consequence: "You can no longer use Tirvea with this account. You may submit an appeal.",
      };
  }
}

// ---------------------------------------------------------------------------
// Graduated enforcement
// ---------------------------------------------------------------------------

/** How long temporary restrictions last. */
export const RESTRICTION_DAYS = { UPLOAD_BLOCKED: 7, LIMITED: 7 } as const;

/** Confidence at/above which a policy-critical signal may auto-suspend. */
export const POLICY_CRITICAL_CONFIDENCE = 0.8;

export type EnforcementInput = {
  userId: string;
  violationType: ModerationCaseType;
  /** Minors / explicit / impersonation class - may suspend pending review. */
  policyCritical?: boolean;
  /** 0-1 confidence of the triggering signal (null = human decision). */
  confidence?: number | null;
  photoId?: string | null;
  moderationCaseId?: string | null;
  /** Staff-facing description - never shown to the user. */
  internalReason: string;
  now?: Date;
};

export type EnforcementOutcome = {
  violationId: string;
  actionTaken: EnforcementAction;
  accountStatus: AccountStatus;
  expiresAt: Date | null;
};

/**
 * Pure ladder decision, exported for tests. `priorCount` = non-reversed
 * violations already on file. Automation NEVER returns BANNED: even a
 * high-confidence policy-critical signal maxes out at SUSPENDED plus an
 * urgent case for a human to confirm.
 */
export function graduatedActionFor(opts: {
  priorCount: number;
  policyCritical: boolean;
  confidence: number | null;
  hasPhotoContext: boolean;
}): EnforcementAction {
  if (opts.policyCritical && (opts.confidence ?? 1) >= POLICY_CRITICAL_CONFIDENCE) {
    return "SUSPENDED";
  }
  if (opts.priorCount === 0) return opts.hasPhotoContext ? "PHOTO_REMOVED" : "WARNING";
  if (opts.priorCount === 1) return opts.hasPhotoContext ? "UPLOAD_BLOCKED" : "LIMITED";
  if (opts.priorCount === 2) return "LIMITED";
  return "SUSPENDED";
}

/** Status the account moves to when an action is applied (null = unchanged). */
export function statusForAction(action: EnforcementAction): AccountStatus | null {
  switch (action) {
    case "LIMITED":
      return "LIMITED";
    case "SUSPENDED":
      return "SUSPENDED";
    case "BANNED":
      return "BANNED";
    default:
      // WARNING / PHOTO_REMOVED / UPLOAD_BLOCKED restrict a capability (via
      // the violation row), not the whole account.
      return null;
  }
}

const NOTICE_FOR_ACTION = {
  WARNING: "warning",
  PHOTO_REMOVED: "photo_removed",
  UPLOAD_BLOCKED: "photo_removed",
  LIMITED: "limited",
  SUSPENDED: "suspended",
  BANNED: "banned",
} as const;

/**
 * Apply graduated enforcement for one confirmed violation signal:
 * decides the rung, writes the AccountViolation (+ account status when the
 * rung demands it), records the audit event and queues the safety notice.
 * Automated callers (photo pipeline) and admin routes both land here so the
 * ladder exists exactly once.
 */
export async function enforceGraduated(input: EnforcementInput): Promise<EnforcementOutcome> {
  const now = input.now ?? new Date();
  const outcome = await db.$transaction(async (tx) => {
    const priorCount = await tx.accountViolation.count({
      where: { userId: input.userId, reversedAt: null },
    });
    const action = graduatedActionFor({
      priorCount,
      policyCritical: input.policyCritical ?? false,
      confidence: input.confidence ?? null,
      hasPhotoContext: !!input.photoId,
    });
    const expiresAt =
      action === "UPLOAD_BLOCKED" || action === "LIMITED"
        ? new Date(now.getTime() + RESTRICTION_DAYS[action] * 24 * 3600 * 1000)
        : null;
    const copy = userVisibleCopyFor(action);

    const violation = await tx.accountViolation.create({
      data: {
        userId: input.userId,
        violationType: input.violationType,
        actionTaken: action,
        description: `${action.toLowerCase()} after ${priorCount} prior violation(s)`,
        userVisibleReason: copy.reason,
        internalReason: input.internalReason,
        expiresAt,
        appealAllowed: true,
        moderationCaseId: input.moderationCaseId ?? null,
        photoId: input.photoId ?? null,
      },
      select: { id: true },
    });

    const nextStatus = statusForAction(action);
    if (nextStatus) {
      await tx.user.update({
        where: { id: input.userId },
        data: {
          status: nextStatus,
          ...(nextStatus === "BANNED"
            ? { bannedAt: now, banReason: copy.reason }
            : {}),
        },
      });
    }
    return { violationId: violation.id, actionTaken: action, expiresAt, nextStatus };
  });

  const user = await db.user.findUnique({
    where: { id: input.userId },
    select: { status: true },
  });

  await recordAuthEvent({
    type: "enforcement_action",
    userId: input.userId,
    metadata: {
      action: outcome.actionTaken,
      violationId: outcome.violationId,
      violationType: input.violationType,
      moderationCaseId: input.moderationCaseId ?? null,
      policyCritical: input.policyCritical ?? false,
    },
  });
  await sendSafetyNotice(
    input.userId,
    NOTICE_FOR_ACTION[outcome.actionTaken],
    `violation:${outcome.violationId}:notice`,
    { violationId: outcome.violationId },
  );

  return {
    violationId: outcome.violationId,
    actionTaken: outcome.actionTaken,
    accountStatus: (user?.status ?? "ACTIVE") as AccountStatus,
    expiresAt: outcome.expiresAt,
  };
}

// ---------------------------------------------------------------------------
// Direct (admin/human) actions
// ---------------------------------------------------------------------------

export type DirectActionInput = {
  userId: string;
  violationType: ModerationCaseType;
  action: Extract<EnforcementAction, "SUSPENDED" | "BANNED" | "LIMITED" | "WARNING">;
  internalReason: string;
  userVisibleReason?: string;
  moderationCaseId?: string | null;
  appealAllowed?: boolean;
  now?: Date;
};

/**
 * Human-decided enforcement (admin routes own the permission check + the
 * AdminLog entry). This is the ONLY path that may produce BANNED.
 */
export async function applyDirectAction(input: DirectActionInput): Promise<EnforcementOutcome> {
  const now = input.now ?? new Date();
  const copy = userVisibleCopyFor(input.action);
  const reason = input.userVisibleReason ?? copy.reason;
  const expiresAt =
    input.action === "LIMITED"
      ? new Date(now.getTime() + RESTRICTION_DAYS.LIMITED * 24 * 3600 * 1000)
      : null;

  const violation = await db.$transaction(async (tx) => {
    const row = await tx.accountViolation.create({
      data: {
        userId: input.userId,
        violationType: input.violationType,
        actionTaken: input.action,
        description: `admin ${input.action.toLowerCase()}`,
        userVisibleReason: reason,
        internalReason: input.internalReason,
        expiresAt,
        appealAllowed: input.appealAllowed ?? true,
        moderationCaseId: input.moderationCaseId ?? null,
      },
      select: { id: true },
    });
    const nextStatus = statusForAction(input.action);
    if (nextStatus) {
      await tx.user.update({
        where: { id: input.userId },
        data: {
          status: nextStatus,
          ...(nextStatus === "BANNED" ? { bannedAt: now, banReason: reason } : {}),
        },
      });
    }
    if (input.moderationCaseId) {
      await tx.moderationCase.update({
        where: { id: input.moderationCaseId },
        data: { status: "ACTION_TAKEN", reviewedAt: now },
      });
    }
    return row;
  });

  if (input.action === "BANNED") {
    await recordBanCredentials(input.userId, input.internalReason);
  }
  await sendSafetyNotice(
    input.userId,
    NOTICE_FOR_ACTION[input.action],
    `violation:${violation.id}:notice`,
    { violationId: violation.id },
  );

  const user = await db.user.findUnique({ where: { id: input.userId }, select: { status: true } });
  return {
    violationId: violation.id,
    actionTaken: input.action,
    accountStatus: (user?.status ?? "ACTIVE") as AccountStatus,
    expiresAt,
  };
}

// ---------------------------------------------------------------------------
// Reversal (approved appeal / false-positive / admin reinstatement)
// ---------------------------------------------------------------------------

/**
 * Reverse one violation and restore everything it took away:
 *  - the violation is marked reversed (kept for the audit trail)
 *  - a hidden photo (photoId on the linked case) is restored to
 *    ACTIVE/APPROVED
 *  - the account status is RECOMPUTED from the remaining active violations
 *    (a user with a second live suspension stays suspended)
 *  - bannedAt/banReason clear when no live ban remains
 *  - ban-evasion credentials for the user are removed when no live ban
 *    remains
 *  - the linked moderation case moves to REVERSED
 */
export async function reverseViolation(
  violationId: string,
  opts: { now?: Date } = {},
): Promise<{ restoredStatus: AccountStatus; restoredPhotoIds: string[] }> {
  const now = opts.now ?? new Date();
  return db.$transaction(async (tx) => {
    const violation = await tx.accountViolation.findUniqueOrThrow({
      where: { id: violationId },
      include: { moderationCase: { select: { id: true, photoId: true } } },
    });
    if (!violation.reversedAt) {
      await tx.accountViolation.update({
        where: { id: violationId },
        data: { reversedAt: now },
      });
    }

    // Restore the hidden photo, if the violation was about one. The
    // violation's own photoId is authoritative; the case's is the fallback
    // for older/admin-created rows (cases dedupe, so it can be stale).
    const restoredPhotoIds: string[] = [];
    const photoId = violation.photoId ?? violation.moderationCase?.photoId;
    if (photoId) {
      const photo = await tx.photo.findUnique({
        where: { id: photoId },
        select: { id: true, status: true, moderation: true },
      });
      if (photo && (photo.status === "REJECTED" || photo.moderation === "REJECTED")) {
        await tx.photo.update({
          where: { id: photoId },
          data: { status: "ACTIVE", moderation: "APPROVED", moderatedAt: now },
        });
        await tx.photoModerationEvent.create({
          data: {
            photoId,
            actorId: null,
            action: "restored",
            reason: `violation ${violationId} reversed (appeal approved / false positive)`,
          },
        });
        restoredPhotoIds.push(photoId);
      }
    }

    if (violation.moderationCaseId) {
      await tx.moderationCase.update({
        where: { id: violation.moderationCaseId },
        data: { status: "REVERSED", reviewedAt: now },
      });
    }

    // Recompute account status from what remains in force.
    const remaining = await tx.accountViolation.findMany({
      where: {
        userId: violation.userId,
        reversedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { actionTaken: true },
    });
    const has = (a: EnforcementAction) => remaining.some((v) => v.actionTaken === a);
    const restoredStatus: AccountStatus = has("BANNED")
      ? "BANNED"
      : has("SUSPENDED")
        ? "SUSPENDED"
        : has("LIMITED")
          ? "LIMITED"
          : "ACTIVE";

    await tx.user.update({
      where: { id: violation.userId },
      data: {
        status: restoredStatus,
        ...(has("BANNED") ? {} : { bannedAt: null, banReason: null }),
      },
    });
    if (!has("BANNED")) {
      await tx.bannedCredential.deleteMany({ where: { sourceUserId: violation.userId } });
    }

    return { restoredStatus, restoredPhotoIds };
  });
}

/**
 * Lazy expiry sweep: when every LIMITED violation has expired, the LIMITED
 * status falls back to ACTIVE. Called from the status read model and the
 * engagement gates so restrictions end on time without a cron. Returns the
 * CURRENT status so callers holding a pre-sweep session use fresh state.
 */
export async function sweepExpiredRestrictions(
  userId: string,
  now = new Date(),
): Promise<AccountStatus | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (!user) return null;
  if (user.status !== "LIMITED") return user.status;
  const live = await db.accountViolation.findFirst({
    where: {
      userId,
      actionTaken: { in: ["LIMITED", "SUSPENDED", "BANNED"] },
      reversedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { id: true },
  });
  if (!live) {
    await db.user.update({ where: { id: userId }, data: { status: "ACTIVE" } });
    return "ACTIVE";
  }
  return "LIMITED";
}

// ---------------------------------------------------------------------------
// Ban evasion - credential blocklist (legally-acceptable signals only)
// ---------------------------------------------------------------------------

/**
 * Snapshot the banned account's verified phone + last device hash into the
 * blocklist. Only these two signals: the phone is verified (strong, owned),
 * the device hash is already salted/coarse (see device.ts privacy stance).
 */
export async function recordBanCredentials(userId: string, reason: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { phoneE164: true, lastDeviceHash: true },
  });
  if (!user) return;
  const rows: { kind: "PHONE" | "DEVICE"; value: string }[] = [];
  if (user.phoneE164) rows.push({ kind: "PHONE", value: user.phoneE164 });
  if (user.lastDeviceHash) rows.push({ kind: "DEVICE", value: user.lastDeviceHash });
  for (const row of rows) {
    await db.bannedCredential.upsert({
      where: { kind_value: { kind: row.kind, value: row.value } },
      create: { ...row, reason, sourceUserId: userId },
      update: { reason, sourceUserId: userId, expiresAt: null },
    });
  }
}

export async function clearBanCredentials(userId: string): Promise<void> {
  await db.bannedCredential.deleteMany({ where: { sourceUserId: userId } });
}

/** Is this credential on the ban blocklist (unexpired)? */
export async function isCredentialBanned(kind: "PHONE" | "DEVICE", value: string): Promise<boolean> {
  const row = await db.bannedCredential.findUnique({
    where: { kind_value: { kind, value } },
    select: { expiresAt: true },
  });
  if (!row) return false;
  return !row.expiresAt || row.expiresAt > new Date();
}

/**
 * Device-hash check at login/registration. A banned DEVICE hash does NOT
 * hard-block (the cookie-based hash can be shared - e.g. a household
 * device); it opens/updates a SYSTEM moderation case for manual review.
 * The PHONE check in the phone flows IS a hard block - a verified number
 * is an owned credential.
 */
export async function flagDeviceBanEvasion(userId: string, deviceHash: string): Promise<boolean> {
  if (!(await isCredentialBanned("DEVICE", deviceHash))) return false;
  await openModerationCase({
    userId,
    caseType: "OTHER",
    severity: "HIGH",
    source: "SYSTEM",
    summary: "Sign-in from a device hash previously associated with a banned account.",
    evidence: { signal: "banned_device_hash" },
  });
  await recordAuthEvent({
    type: "ban_evasion_device_flag",
    userId,
    metadata: { signal: "banned_device_hash" },
  });
  return true;
}
