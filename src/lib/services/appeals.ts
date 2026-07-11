import { db } from "@/lib/db";
import type {
  AppealStatus,
  EnforcementAction,
  ModerationCaseType,
} from "@/generated/prisma/enums";
import { audit } from "@/lib/audit";
import { recordAuthEvent } from "@/lib/auth/audit";
import { sendSafetyNotice } from "@/lib/services/safety-notices";
import {
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
  | "appeal_not_pending";

const APPEAL_ERROR_STATUS: Record<AppealErrorCode, number> = {
  violation_not_found: 404,
  appeal_not_allowed: 403,
  appeal_already_open: 409,
  appeal_already_decided: 409,
  appeal_rate_limited: 429,
  appeal_not_found: 404,
  appeal_not_pending: 409,
};

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
    if (existing?.status === "SUBMITTED" || existing?.status === "PENDING_REVIEW") {
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
  if (appeal.status !== "SUBMITTED" && appeal.status !== "PENDING_REVIEW") {
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
    },
  });
  if (claimed.count === 0) {
    throw new AppealError("appeal_not_pending", "This appeal has already been decided.");
  }

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
// Account status read model (phase-2 UI renders this verbatim)
// ---------------------------------------------------------------------------

export type ViolationTab = "active" | "expired" | "appealed";

export type AppealView = {
  id: string;
  status: AppealStatus;
  submittedAt: Date;
  decidedAt: Date | null;
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
  // Lazy expiry first so a lapsed LIMITED shows as ACTIVE.
  await sweepExpiredRestrictions(userId);

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
            select: { id: true, status: true, createdAt: true, reviewedAt: true },
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
    const tab: ViolationTab = latestAppeal ? "appealed" : expired ? "expired" : "active";
    const canAppeal = v.appealAllowed && !v.reversedAt && !latestAppeal;
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

export async function listAppeals(filter: { status?: AppealStatus; take?: number } = {}) {
  return db.appeal.findMany({
    where: filter.status ? { status: filter.status } : undefined,
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
    },
  });
}

export async function listModerationCases(
  filter: {
    status?: "OPEN" | "UNDER_REVIEW" | "ACTION_TAKEN" | "DISMISSED" | "APPEALED" | "REVERSED";
    severity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    take?: number;
  } = {},
) {
  return db.moderationCase.findMany({
    where: {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.severity ? { severity: filter.severity } : {}),
    },
    // Most urgent first, oldest first within a severity.
    orderBy: [{ severity: "desc" }, { createdAt: "asc" }],
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
}
