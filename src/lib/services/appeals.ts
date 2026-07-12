import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type {
  AppealStatus,
  EnforcementAction,
  ModerationCaseType,
} from "@/generated/prisma/enums";
import { audit } from "@/lib/audit";
import { recordAuthEvent } from "@/lib/auth/audit";
import { sendSafetyNotice } from "@/lib/services/safety-notices";
import {
  isCaseOverdue,
  reverseViolation,
  sweepExpiredRestrictions,
  userVisibleCopyFor,
} from "@/lib/services/trust-safety";
import { recomputeTrustForEvent } from "@/lib/services/trust-engine";

/**
 * Appeals + the account-status read model the phase-2 UI renders.
 *
 * Boundary rule: everything returned by getAccountStatusView is USER-VISIBLE
 * ONLY - no internalReason, no confidence, no thresholds, no case evidence.
 * Staff surfaces read the raw rows through the admin services/routes.
 */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type AppealErrorCode =
  | "violation_not_found"
  | "appeal_not_allowed"
  | "appeal_already_open"
  | "appeal_already_decided"
  | "appeal_rate_limited"
  | "appeal_not_found"
  | "appeal_not_pending"
  | "appeal_not_needs_info";

const APPEAL_ERROR_STATUS: Record<AppealErrorCode, number> = {
  violation_not_found: 404,
  appeal_not_allowed: 403,
  appeal_already_open: 409,
  appeal_already_decided: 409,
  appeal_rate_limited: 429,
  appeal_not_found: 404,
  appeal_not_pending: 409,
  appeal_not_needs_info: 409,
};

// ---------------------------------------------------------------------------
// Lifecycle sets (see AppealStatus in the schema)
// ---------------------------------------------------------------------------

/** Awaiting some action - blocks a second appeal on the same violation. */
export const OPEN_APPEAL_STATUSES = [
  "SUBMITTED",
  "PENDING_REVIEW", // legacy alias of SUBMITTED - treated identically
  "UNDER_REVIEW",
  "NEEDS_INFO",
] as const satisfies readonly AppealStatus[];

/** A human decided - final for that violation. */
export const DECIDED_APPEAL_STATUSES = ["APPROVED", "REJECTED"] as const satisfies readonly AppealStatus[];

/** Closed without a decision - the user may appeal the violation again. */
export const REOPENABLE_APPEAL_STATUSES = ["WITHDRAWN", "EXPIRED"] as const satisfies readonly AppealStatus[];

export function isOpenAppealStatus(status: string): boolean {
  return (OPEN_APPEAL_STATUSES as readonly string[]).includes(status);
}

/** Days a NEEDS_INFO appeal waits for the user before auto-expiring. */
export const NEEDS_INFO_EXPIRY_DAYS = 14;

export class AppealError extends Error {
  readonly httpStatus: number;
  constructor(
    readonly code: AppealErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AppealError";
    this.httpStatus = APPEAL_ERROR_STATUS[code];
  }
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

/** Max appeals one account may submit per rolling day (service-level guard
 *  on top of the route rate limit). */
export const MAX_APPEALS_PER_DAY = 3;

export type SubmitAppealResult = { appealId: string; status: AppealStatus };

/**
 * Submit an appeal against one violation. Rules:
 *  - the violation must belong to the caller and carry appealAllowed
 *  - a reversed violation has nothing left to appeal
 *  - ONE open appeal per violation (SUBMITTED/PENDING_REVIEW -> 409), and a
 *    decided appeal is final (double appeal -> 409) - checked inside the
 *    transaction (status-dependent, FirstMessage pattern)
 *  - suspended/banned accounts MAY appeal (that is the point); the caller
 *    resolves the user with the restricted-tolerant session path
 */
export async function submitAppeal(input: {
  userId: string;
  violationId: string;
  appealText: string;
}): Promise<SubmitAppealResult> {
  const text = input.appealText.trim();
  if (text.length < 10 || text.length > 2000) {
    throw new AppealError(
      "appeal_not_allowed",
      "Please describe why you are appealing (10-2000 characters).",
    );
  }

  const appeal = await db.$transaction(async (tx) => {
    const violation = await tx.accountViolation.findFirst({
      where: { id: input.violationId, userId: input.userId },
      select: { id: true, appealAllowed: true, reversedAt: true },
    });
    if (!violation) {
      throw new AppealError("violation_not_found", "That violation does not exist.");
    }
    if (!violation.appealAllowed) {
      throw new AppealError("appeal_not_allowed", "This decision is not appealable.");
    }
    if (violation.reversedAt) {
      throw new AppealError("appeal_already_decided", "This action was already reversed.");
    }

    const existing = await tx.appeal.findFirst({
      where: { violationId: violation.id },
      orderBy: { createdAt: "desc" },
      select: { status: true },
    });
    if (existing && isOpenAppealStatus(existing.status)) {
      throw new AppealError(
        "appeal_already_open",
        "An appeal for this decision is already being reviewed.",
      );
    }
    if (existing?.status === "REJECTED" || existing?.status === "APPROVED") {
      throw new AppealError(
        "appeal_already_decided",
        "This decision has already been through an appeal.",
      );
    }
    // WITHDRAWN/EXPIRED closed without a decision - a fresh appeal may open.

    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
    const recent = await tx.appeal.count({
      where: { userId: input.userId, createdAt: { gte: dayAgo } },
    });
    if (recent >= MAX_APPEALS_PER_DAY) {
      throw new AppealError(
        "appeal_rate_limited",
        "You have reached the appeal limit for today. Please try again tomorrow.",
      );
    }

    const created = await tx.appeal.create({
      data: {
        violationId: violation.id,
        userId: input.userId,
        status: "SUBMITTED",
        appealText: text,
        events: {
          create: { type: "submitted", actorRole: "USER", note: null },
        },
      },
      select: { id: true, status: true, violation: { select: { moderationCaseId: true } } },
    });
    if (created.violation.moderationCaseId) {
      await tx.moderationCase.update({
        where: { id: created.violation.moderationCaseId },
        data: { status: "APPEALED" },
      });
    }
    return created;
  });

  await recordAuthEvent({
    type: "appeal_submitted",
    userId: input.userId,
    metadata: { appealId: appeal.id, violationId: input.violationId },
  });
  await sendSafetyNotice(input.userId, "appeal_submitted", `appeal:${appeal.id}:submitted`, {
    appealId: appeal.id,
  });

  return { appealId: appeal.id, status: appeal.status };
}

// ---------------------------------------------------------------------------
// Decide (admin)
// ---------------------------------------------------------------------------

export type ReviewAppealResult = {
  appealId: string;
  status: AppealStatus;
  /** Set on approval - what the account was restored to. */
  restoredStatus: string | null;
  restoredPhotoIds: string[];
};

/**
 * Admin decision on an appeal. Approval REVERSES the violation through
 * trust-safety.reverseViolation (account status recomputed, photos
 * restored, case -> REVERSED, ban credentials lifted when no ban remains).
 * Rejection records the notes and leaves the action in force. Both paths
 * audit via AdminLog and notify the user.
 */
export async function reviewAppeal(input: {
  actorId: string;
  appealId: string;
  decision: "approve" | "reject";
  adminNotes?: string;
  req?: Request;
}): Promise<ReviewAppealResult> {
  const appeal = await db.appeal.findUnique({
    where: { id: input.appealId },
    select: { id: true, status: true, userId: true, violationId: true },
  });
  if (!appeal) throw new AppealError("appeal_not_found", "Appeal not found.");
  // Any pre-decision state may be decided (a NEEDS_INFO appeal can still be
  // approved/rejected if staff have enough to go on).
  if (!isOpenAppealStatus(appeal.status)) {
    throw new AppealError("appeal_not_pending", "This appeal has already been decided.");
  }

  const now = new Date();
  const nextStatus: AppealStatus = input.decision === "approve" ? "APPROVED" : "REJECTED";

  // Guard against a concurrent decision: only one reviewer wins.
  const claimed = await db.appeal.updateMany({
    where: { id: appeal.id, status: appeal.status },
    data: {
      status: nextStatus,
      adminNotes: input.adminNotes ?? null,
      reviewedById: input.actorId,
      reviewedAt: now,
      needsInfoRequestedAt: null,
    },
  });
  if (claimed.count === 0) {
    throw new AppealError("appeal_not_pending", "This appeal has already been decided.");
  }
  await db.appealEvent.create({
    data: {
      appealId: appeal.id,
      type: input.decision === "approve" ? "approved" : "rejected",
      actorRole: "STAFF",
      // USER-VISIBLE timeline copy only - input.adminNotes stays private.
      note: null,
    },
  });

  let restoredStatus: string | null = null;
  let restoredPhotoIds: string[] = [];
  if (input.decision === "approve") {
    const reversal = await reverseViolation(appeal.violationId, { now });
    restoredStatus = reversal.restoredStatus;
    restoredPhotoIds = reversal.restoredPhotoIds;
  }

  await audit({
    actorId: input.actorId,
    action: `appeal.${input.decision}`,
    targetType: "appeal",
    targetId: appeal.id,
    metadata: {
      violationId: appeal.violationId,
      userId: appeal.userId,
      ...(restoredStatus ? { restoredStatus } : {}),
      ...(input.adminNotes ? { notes: input.adminNotes } : {}),
    },
  });
  await sendSafetyNotice(
    appeal.userId,
    input.decision === "approve" ? "appeal_approved" : "appeal_rejected",
    `appeal:${appeal.id}:${input.decision}`,
    { appealId: appeal.id },
  );
  await recomputeTrustForEvent(appeal.userId, "appeal_decided");

  return { appealId: appeal.id, status: nextStatus, restoredStatus, restoredPhotoIds };
}

// ---------------------------------------------------------------------------
// Lifecycle: withdraw (user), needs-info round trip, under-review, expiry
// ---------------------------------------------------------------------------

/**
 * User withdraws their own appeal - only while it is pre-decision. The
 * violation stays in force; because a withdrawal is not a decision, the
 * user may submit a fresh appeal later.
 */
export async function withdrawAppeal(input: {
  userId: string;
  appealId: string;
}): Promise<{ appealId: string; status: AppealStatus }> {
  const appeal = await db.appeal.findFirst({
    // Ownership INSIDE the lookup - a foreign id reads as not-found (no IDOR).
    where: { id: input.appealId, userId: input.userId },
    select: { id: true, status: true, violation: { select: { moderationCaseId: true } } },
  });
  if (!appeal) throw new AppealError("appeal_not_found", "Appeal not found.");
  if (!isOpenAppealStatus(appeal.status)) {
    throw new AppealError("appeal_not_pending", "This appeal can no longer be withdrawn.");
  }

  const claimed = await db.appeal.updateMany({
    where: { id: appeal.id, status: appeal.status },
    data: { status: "WITHDRAWN", needsInfoRequestedAt: null },
  });
  if (claimed.count === 0) {
    throw new AppealError("appeal_not_pending", "This appeal can no longer be withdrawn.");
  }
  await db.appealEvent.create({
    data: { appealId: appeal.id, type: "withdrawn", actorRole: "USER", note: null },
  });
  // The case had moved to APPEALED on submit; with the appeal gone and the
  // violation still in force, it returns to ACTION_TAKEN.
  if (appeal.violation.moderationCaseId) {
    await db.moderationCase.updateMany({
      where: { id: appeal.violation.moderationCaseId, status: "APPEALED" },
      data: { status: "ACTION_TAKEN", lastActivityAt: new Date() },
    });
  }
  await recordAuthEvent({
    type: "appeal_withdrawn",
    userId: input.userId,
    metadata: { appealId: appeal.id },
  });
  await sendSafetyNotice(input.userId, "appeal_withdrawn", `appeal:${appeal.id}:withdrawn`, {
    appealId: appeal.id,
  });
  return { appealId: appeal.id, status: "WITHDRAWN" };
}

/** Staff marks an appeal as actively being reviewed. */
export async function markAppealUnderReview(input: {
  actorId: string;
  appealId: string;
}): Promise<{ appealId: string; status: AppealStatus }> {
  const appeal = await db.appeal.findUnique({
    where: { id: input.appealId },
    select: { id: true, status: true },
  });
  if (!appeal) throw new AppealError("appeal_not_found", "Appeal not found.");
  if (appeal.status !== "SUBMITTED" && appeal.status !== "PENDING_REVIEW") {
    throw new AppealError("appeal_not_pending", "This appeal is not awaiting review.");
  }
  const claimed = await db.appeal.updateMany({
    where: { id: appeal.id, status: appeal.status },
    data: { status: "UNDER_REVIEW", reviewedById: input.actorId },
  });
  if (claimed.count === 0) {
    throw new AppealError("appeal_not_pending", "This appeal is not awaiting review.");
  }
  await db.appealEvent.create({
    data: { appealId: appeal.id, type: "under_review", actorRole: "STAFF", note: null },
  });
  return { appealId: appeal.id, status: "UNDER_REVIEW" };
}

/**
 * Staff asks the user for more information. `message` is USER-VISIBLE (it
 * is the question) and lands on the timeline; staff-private commentary
 * belongs in adminNotes via the decide flow. The user gets 14 days to
 * respond before the appeal auto-expires.
 */
export async function requestAppealInfo(input: {
  actorId: string;
  appealId: string;
  message: string;
}): Promise<{ appealId: string; status: AppealStatus }> {
  const message = input.message.trim();
  if (message.length < 3 || message.length > 1000) {
    throw new AppealError("appeal_not_allowed", "The question must be 3-1000 characters.");
  }
  const appeal = await db.appeal.findUnique({
    where: { id: input.appealId },
    select: { id: true, status: true, userId: true },
  });
  if (!appeal) throw new AppealError("appeal_not_found", "Appeal not found.");
  if (!isOpenAppealStatus(appeal.status) || appeal.status === "NEEDS_INFO") {
    throw new AppealError("appeal_not_pending", "This appeal cannot be asked for more information.");
  }
  const now = new Date();
  const claimed = await db.appeal.updateMany({
    where: { id: appeal.id, status: appeal.status },
    data: { status: "NEEDS_INFO", needsInfoRequestedAt: now, reviewedById: input.actorId },
  });
  if (claimed.count === 0) {
    throw new AppealError("appeal_not_pending", "This appeal cannot be asked for more information.");
  }
  await db.appealEvent.create({
    data: {
      appealId: appeal.id,
      type: "needs_info_requested",
      actorRole: "STAFF",
      note: message,
    },
  });
  await sendSafetyNotice(appeal.userId, "appeal_needs_info", `appeal:${appeal.id}:needs-info:${now.getTime()}`, {
    appealId: appeal.id,
  });
  return { appealId: appeal.id, status: "NEEDS_INFO" };
}

/**
 * The user answers a NEEDS_INFO question - ONE response per round trip;
 * the appeal returns to UNDER_REVIEW for staff.
 */
export async function respondAppealInfo(input: {
  userId: string;
  appealId: string;
  message: string;
}): Promise<{ appealId: string; status: AppealStatus }> {
  const message = input.message.trim();
  if (message.length < 3 || message.length > 2000) {
    throw new AppealError("appeal_not_allowed", "Your reply must be 3-2000 characters.");
  }
  const appeal = await db.appeal.findFirst({
    where: { id: input.appealId, userId: input.userId }, // ownership = not-found
    select: { id: true, status: true },
  });
  if (!appeal) throw new AppealError("appeal_not_found", "Appeal not found.");
  if (appeal.status !== "NEEDS_INFO") {
    throw new AppealError("appeal_not_needs_info", "This appeal is not waiting on your reply.");
  }
  const claimed = await db.appeal.updateMany({
    where: { id: appeal.id, status: "NEEDS_INFO" },
    data: { status: "UNDER_REVIEW", needsInfoRequestedAt: null },
  });
  if (claimed.count === 0) {
    throw new AppealError("appeal_not_needs_info", "This appeal is not waiting on your reply.");
  }
  await db.appealEvent.create({
    data: { appealId: appeal.id, type: "user_responded", actorRole: "USER", note: message },
  });
  await recordAuthEvent({
    type: "appeal_info_response",
    userId: input.userId,
    metadata: { appealId: appeal.id },
  });
  return { appealId: appeal.id, status: "UNDER_REVIEW" };
}

/**
 * Sweep: NEEDS_INFO appeals whose question went unanswered for
 * NEEDS_INFO_EXPIRY_DAYS expire (system close - the user may appeal the
 * violation again). Called lazily from getAccountStatusView (scoped to one
 * user) and globally by /api/cron/notifications.
 */
export async function expireStaleNeedsInfo(
  opts: { userId?: string; now?: Date } = {},
): Promise<number> {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - NEEDS_INFO_EXPIRY_DAYS * 24 * 3600 * 1000);
  const stale = await db.appeal.findMany({
    where: {
      status: "NEEDS_INFO",
      needsInfoRequestedAt: { lt: cutoff },
      ...(opts.userId ? { userId: opts.userId } : {}),
    },
    take: 100,
    select: { id: true, userId: true },
  });
  let expired = 0;
  for (const appeal of stale) {
    const claimed = await db.appeal.updateMany({
      where: { id: appeal.id, status: "NEEDS_INFO" },
      data: { status: "EXPIRED" },
    });
    if (claimed.count === 0) continue;
    expired += 1;
    await db.appealEvent.create({
      data: {
        appealId: appeal.id,
        type: "expired",
        actorRole: "SYSTEM",
        note: "No reply was received within 14 days, so this appeal was closed.",
      },
    });
    await sendSafetyNotice(appeal.userId, "appeal_expired", `appeal:${appeal.id}:expired`, {
      appealId: appeal.id,
    });
  }
  return expired;
}

// ---------------------------------------------------------------------------
// Appeal attachments - designed, NOT enabled (honest flag)
// ---------------------------------------------------------------------------

/**
 * Evidence attachments for appeals are DESIGNED BUT NOT ENABLED. The
 * intended shape (when APPEAL_ATTACHMENTS_ENABLED="true" ships):
 *  - 1-3 images per appeal, uploaded through the SAME sharp validation
 *    pipeline as profile photos (decode -> re-encode webp, size caps),
 *    stored in the private bucket under users/{uid}/appeals/{appealId}/
 *  - served staff-only through the media-proxy pattern (permission check
 *    + short-lived signed URL; never public)
 *  - an AppealEvent type "attachment_added" records each upload
 * Until then this flag reports false and the API surface returns an honest
 * 501 - nothing pretends to accept files it would drop.
 */
export function appealAttachmentsEnabled(): boolean {
  return process.env.APPEAL_ATTACHMENTS_ENABLED?.trim().toLowerCase() === "true";
}

// ---------------------------------------------------------------------------
// Account status read model (phase-2 UI renders this verbatim)
// ---------------------------------------------------------------------------

export type ViolationTab = "active" | "expired" | "appealed";

/** One user-visible timeline entry (note is user-safe copy by contract). */
export type AppealTimelineEntry = {
  type: string;
  actorRole: "USER" | "STAFF" | "SYSTEM";
  note: string | null;
  at: Date;
};

export type AppealView = {
  id: string;
  status: AppealStatus;
  submittedAt: Date;
  decidedAt: Date | null;
  /** True while the appeal is pre-decision (user may withdraw it). */
  canWithdraw: boolean;
  /** True when staff asked for more info and the user has not replied. */
  canRespond: boolean;
  /** Deadline for the NEEDS_INFO reply (submittedAt+14d of the request). */
  respondBy: Date | null;
  timeline: AppealTimelineEntry[];
};

export type ViolationView = {
  id: string;
  violationType: ModerationCaseType;
  actionTaken: EnforcementAction;
  /** Calm, legally-safe copy - the ONLY reason text the user sees. */
  userVisibleReason: string;
  consequence: string;
  createdAt: Date;
  expiresAt: Date | null;
  tab: ViolationTab;
  appealAllowed: boolean;
  /** True when the user may submit an appeal right now. */
  canAppeal: boolean;
  appeal: AppealView | null;
};

export type AccountStatusView = {
  status: string;
  statusCard: { headline: string; body: string };
  violations: ViolationView[];
};

const STATUS_CARD: Record<string, { headline: string; body: string }> = {
  ACTIVE: {
    headline: "Your account is in good standing",
    body: "Everything is normal. Thanks for keeping Tirvea safe.",
  },
  LIMITED: {
    headline: "Your account is temporarily limited",
    body: "Sending likes and messages is paused for a short period. You can still browse and read your conversations.",
  },
  PHOTO_REVIEW_REQUIRED: {
    headline: "Please verify your profile photos",
    body: "To keep using every feature, complete photo verification. It only takes a minute.",
  },
  SUSPENDED: {
    headline: "Your account is suspended",
    body: "A member of our team is reviewing your account. You can read the details below and submit an appeal.",
  },
  BANNED: {
    headline: "Your account has been closed",
    body: "This account can no longer be used on Tirvea. If you believe this is a mistake, you can submit an appeal - a person will review it.",
  },
  SHADOW_BANNED: {
    headline: "Your account is under review",
    body: "Some visibility is reduced while our team reviews recent activity.",
  },
  DEACTIVATED: {
    headline: "Your account is deactivated",
    body: "Sign in again any time to reactivate your account.",
  },
};

/**
 * The user-facing account status read model: status card + violations in
 * their tabs (active / expired / appealed) with per-violation appeal state.
 * User-visible fields ONLY - internal reasons, confidence and thresholds
 * never leave the server.
 */
export async function getAccountStatusView(userId: string): Promise<AccountStatusView | null> {
  // Lazy sweeps first so a lapsed LIMITED shows as ACTIVE and a stale
  // NEEDS_INFO appeal shows as EXPIRED.
  await sweepExpiredRestrictions(userId);
  await expireStaleNeedsInfo({ userId });

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      status: true,
      violations: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          violationType: true,
          actionTaken: true,
          userVisibleReason: true,
          expiresAt: true,
          appealAllowed: true,
          reversedAt: true,
          createdAt: true,
          appeals: {
            orderBy: { createdAt: "desc" },
            take: 1,
            // USER-VISIBLE fields only: never adminNotes / reviewedById.
            select: {
              id: true,
              status: true,
              createdAt: true,
              reviewedAt: true,
              needsInfoRequestedAt: true,
              events: {
                orderBy: { createdAt: "asc" },
                select: { type: true, actorRole: true, note: true, createdAt: true },
              },
            },
          },
        },
      },
    },
  });
  if (!user) return null;

  const now = new Date();
  const violations: ViolationView[] = user.violations.map((v) => {
    const latestAppeal = v.appeals[0] ?? null;
    const expired = v.reversedAt !== null || (v.expiresAt !== null && v.expiresAt <= now);
    // A withdrawn/expired appeal closed without a decision - the violation
    // shows in its normal tab again and a fresh appeal is allowed.
    const appealCounts =
      !!latestAppeal &&
      !(REOPENABLE_APPEAL_STATUSES as readonly string[]).includes(latestAppeal.status);
    const tab: ViolationTab = appealCounts ? "appealed" : expired ? "expired" : "active";
    const canAppeal = v.appealAllowed && !v.reversedAt && !appealCounts;
    return {
      id: v.id,
      violationType: v.violationType,
      actionTaken: v.actionTaken,
      userVisibleReason: v.userVisibleReason,
      consequence: userVisibleCopyFor(v.actionTaken).consequence,
      createdAt: v.createdAt,
      expiresAt: v.expiresAt,
      tab,
      appealAllowed: v.appealAllowed,
      canAppeal,
      appeal: latestAppeal
        ? {
            id: latestAppeal.id,
            status: latestAppeal.status,
            submittedAt: latestAppeal.createdAt,
            decidedAt: latestAppeal.reviewedAt,
            canWithdraw: isOpenAppealStatus(latestAppeal.status),
            canRespond: latestAppeal.status === "NEEDS_INFO",
            respondBy:
              latestAppeal.status === "NEEDS_INFO" && latestAppeal.needsInfoRequestedAt
                ? new Date(
                    latestAppeal.needsInfoRequestedAt.getTime() +
                      NEEDS_INFO_EXPIRY_DAYS * 24 * 3600 * 1000,
                  )
                : null,
            timeline: latestAppeal.events.map((e) => ({
              type: e.type,
              actorRole: e.actorRole,
              note: e.note,
              at: e.createdAt,
            })),
          }
        : null,
    };
  });

  return {
    status: user.status,
    statusCard: STATUS_CARD[user.status] ?? STATUS_CARD.ACTIVE,
    violations,
  };
}

// ---------------------------------------------------------------------------
// Staff list read models (phase-2 admin dashboard)
// ---------------------------------------------------------------------------

export async function listAppeals(
  filter: { status?: AppealStatus; statuses?: AppealStatus[]; take?: number } = {},
) {
  return db.appeal.findMany({
    where: filter.status
      ? { status: filter.status }
      : filter.statuses?.length
        ? { status: { in: filter.statuses } }
        : undefined,
    orderBy: { createdAt: "asc" },
    take: Math.min(filter.take ?? 50, 200),
    include: {
      violation: {
        select: {
          id: true,
          violationType: true,
          actionTaken: true,
          userVisibleReason: true,
          internalReason: true,
          moderationCaseId: true,
          createdAt: true,
        },
      },
      user: { select: { id: true, email: true, status: true } },
      // Full timeline for staff (notes here are user-visible copy;
      // adminNotes rides on the appeal row itself, staff-only).
      events: {
        orderBy: { createdAt: "asc" },
        select: { type: true, actorRole: true, note: true, createdAt: true },
      },
    },
  });
}

export type ModerationCaseFilter = {
  status?: "OPEN" | "UNDER_REVIEW" | "ACTION_TAKEN" | "DISMISSED" | "APPEALED" | "REVERSED";
  severity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  /** "me:{userId}" filters to one assignee; "unassigned" to nobody. */
  assignedToId?: string | "unassigned";
  overdueOnly?: boolean;
  /**
   * Server-side text search: exact case id / user id match, or a
   * case-insensitive contains on the user email. Index-friendly: the id
   * arms hit primary keys; the email arm is a bounded ILIKE on User.email
   * (unique-indexed column, small staff-facing result sets).
   */
  search?: string;
  take?: number;
};

function moderationCaseWhere(
  filter: ModerationCaseFilter,
  now: Date,
): Prisma.ModerationCaseWhereInput {
  const search = filter.search?.trim();
  return {
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.severity ? { severity: filter.severity } : {}),
    ...(filter.priority ? { priority: filter.priority } : {}),
    ...(filter.assignedToId === "unassigned"
      ? { assignedToId: null }
      : filter.assignedToId
        ? { assignedToId: filter.assignedToId }
        : {}),
    ...(filter.overdueOnly
      ? {
          resolvedAt: null,
          slaDueAt: { lt: now },
          status: filter.status ?? { in: ["OPEN", "UNDER_REVIEW", "APPEALED"] },
        }
      : {}),
    ...(search
      ? {
          OR: [
            { id: search },
            { userId: search },
            { user: { email: { contains: search, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };
}

export async function listModerationCases(filter: ModerationCaseFilter = {}) {
  const now = new Date();
  const rows = await db.moderationCase.findMany({
    where: moderationCaseWhere(filter, now),
    // Most urgent first (queue priority, not raw severity), oldest first
    // within a priority tier.
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: Math.min(filter.take ?? 50, 200),
    include: {
      user: {
        select: {
          id: true,
          email: true,
          status: true,
          safetyRiskScore: true,
          safetyRecommendedAction: true,
        },
      },
      violations: { select: { id: true, actionTaken: true, reversedAt: true } },
    },
  });
  // isOverdue is derived (single definition in trust-safety.isCaseOverdue).
  return rows.map((c) => ({ ...c, isOverdue: isCaseOverdue(c, now) }));
}

/** Honest total for the current filter (the list itself is take-limited). */
export async function countModerationCases(
  filter: Omit<ModerationCaseFilter, "take"> = {},
): Promise<number> {
  return db.moderationCase.count({ where: moderationCaseWhere(filter, new Date()) });
}

/** Staff read model: provider health of the moderation fallback chain. */
export async function listProviderHealth() {
  return db.providerHealth.findMany({ orderBy: { provider: "asc" } });
}
