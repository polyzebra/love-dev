/** Shared badge/label vocabulary for the trust & safety admin pages. */

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export function pretty(value: string): string {
  return value.toLowerCase().replace(/_/g, " ");
}

/**
 * Admin id-display convention: first 8 chars + ellipsis, monospace at the
 * call site, full id in a title attribute. Never truncate an id silently -
 * always pair with title={id}.
 */
export function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

/**
 * Humanize an AdminLog action code ("safety.enforce.banned" ->
 * "safety · enforce banned"). Deterministic - never invents words, so an
 * unknown action still reads sensibly. Pair with title={action} for the
 * raw code.
 */
export function humanizeAdminAction(action: string): string {
  const [domain, ...rest] = action.split(".");
  if (rest.length === 0) return pretty(domain);
  return `${pretty(domain)} · ${rest.map((part) => pretty(part.replace(/-/g, " "))).join(" ")}`;
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
  UNDER_REVIEW: "secondary",
  NEEDS_INFO: "default",
  APPROVED: "outline",
  REJECTED: "outline",
  EXPIRED: "outline",
  WITHDRAWN: "outline",
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

export const PAYMENT_STATUS_BADGE: Record<string, BadgeVariant> = {
  SUCCEEDED: "secondary",
  PENDING: "default",
  FAILED: "destructive",
  REFUNDED: "outline",
};

export const VERIFICATION_STATUS_BADGE: Record<string, BadgeVariant> = {
  APPROVED: "secondary",
  PENDING: "default",
  IN_REVIEW: "default",
  REJECTED: "destructive",
  EXPIRED: "outline",
};

/** auth.users.phone mirror disposition (User.phoneSyncStatus). */
export const PHONE_SYNC_BADGE: Record<string, BadgeVariant> = {
  SYNCED: "secondary",
  PENDING: "outline",
  FAILED: "destructive",
};
