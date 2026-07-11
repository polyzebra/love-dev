/** Shared badge/label vocabulary for the trust & safety admin pages. */

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export function pretty(value: string): string {
  return value.toLowerCase().replace(/_/g, " ");
}

export const SEVERITY_BADGE: Record<string, BadgeVariant> = {
  CRITICAL: "destructive",
  HIGH: "default",
  MEDIUM: "secondary",
  LOW: "outline",
};

export const CASE_STATUS_BADGE: Record<string, BadgeVariant> = {
  OPEN: "default",
  UNDER_REVIEW: "secondary",
  APPEALED: "destructive",
  ACTION_TAKEN: "outline",
  DISMISSED: "outline",
  REVERSED: "outline",
};

export const ENFORCEMENT_BADGE: Record<string, BadgeVariant> = {
  BANNED: "destructive",
  SUSPENDED: "destructive",
  LIMITED: "secondary",
  UPLOAD_BLOCKED: "secondary",
  PHOTO_REMOVED: "outline",
  WARNING: "outline",
};

export const APPEAL_STATUS_BADGE: Record<string, BadgeVariant> = {
  SUBMITTED: "default",
  PENDING_REVIEW: "secondary",
  APPROVED: "outline",
  REJECTED: "outline",
};

export const ACCOUNT_STATUS_BADGE: Record<string, BadgeVariant> = {
  ACTIVE: "secondary",
  LIMITED: "secondary",
  PHOTO_REVIEW_REQUIRED: "secondary",
  SUSPENDED: "destructive",
  BANNED: "destructive",
  SHADOW_BANNED: "outline",
  DEACTIVATED: "outline",
  DELETED: "outline",
};
