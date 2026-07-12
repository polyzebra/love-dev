import type {
  AppealStatus,
  EnforcementAction,
  ModerationCaseType,
} from "@/generated/prisma/enums";

/**
 * User-facing vocabulary for the Appeals Centre. Calm, human words only -
 * never enum shouting, never detection internals. The per-violation reason
 * and consequence sentences come from the server read model
 * (getAccountStatusView); this module only labels the enums around them.
 */

export const VIOLATION_TYPE_LABEL: Record<ModerationCaseType, string> = {
  PHOTO_MISMATCH: "Images that may not represent you",
  STOLEN_IMAGES: "Images that may belong to someone else",
  EXPLICIT_CONTENT: "Content that may not be appropriate",
  MINOR_SAFETY: "Content affecting the safety of minors",
  IMPERSONATION: "Impersonating another person",
  SPAM: "Spam or commercial activity",
  HARASSMENT: "Behaviour that may make others feel unsafe",
  SCAM: "Activity that may mislead other members",
  PAYMENT_ABUSE: "Payment activity that needed review",
  OTHER: "Activity that may not follow our guidelines",
};

export const ACTION_LABEL: Record<EnforcementAction, string> = {
  WARNING: "Warning issued",
  PHOTO_REMOVED: "Photo removed",
  UPLOAD_BLOCKED: "Photo uploads paused",
  LIMITED: "Account limited",
  SUSPENDED: "Account suspended",
  BANNED: "Account closed",
};

export const APPEAL_STATUS_LABEL: Record<AppealStatus, string> = {
  SUBMITTED: "Pending review",
  PENDING_REVIEW: "Pending review",
  UNDER_REVIEW: "Being reviewed",
  NEEDS_INFO: "Waiting for your reply",
  APPROVED: "Approved",
  REJECTED: "Reviewed - decision upheld",
  EXPIRED: "Closed - no reply received",
  WITHDRAWN: "Withdrawn by you",
};

/** Copy shown next to the right-to-appeal section on the violation page. */
export const APPEAL_RIGHT_COPY =
  "You have the right to appeal this decision. A member of our Trust & Safety team - a person, not a system - will take a careful look. If your appeal is approved, we'll reverse the action taken.";

export const APPEAL_PENDING_COPY =
  "Our Trust & Safety team will review your appeal and email you once a decision has been made.";

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-IE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}
