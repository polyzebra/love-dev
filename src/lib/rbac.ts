import type { Role } from "@/generated/prisma/enums";

/**
 * Role-based access control. Permissions are explicit - least privilege -
 * so a new capability must be added here before any route can use it.
 *
 * Tiers: MODERATOR < ADMIN < SUPER_ADMIN. SUPER_ADMIN holds every ADMIN
 * permission plus the supers-only tier below; existing ADMIN permissions
 * are unchanged. There is no wildcard - SUPER_ADMIN is listed explicitly
 * so removing it from a permission is a one-line, auditable change.
 */
export const PERMISSIONS = {
  "users:read": ["MODERATOR", "ADMIN", "SUPER_ADMIN"],
  "users:suspend": ["MODERATOR", "ADMIN", "SUPER_ADMIN"],
  // Identity-touching actions: release phone/email, forced re-verification,
  // onboarding resets. Admin-only - they change what can authenticate.
  "users:manage": ["ADMIN", "SUPER_ADMIN"],
  "users:delete": ["ADMIN", "SUPER_ADMIN"],
  "reports:read": ["MODERATOR", "ADMIN", "SUPER_ADMIN"],
  "reports:resolve": ["MODERATOR", "ADMIN", "SUPER_ADMIN"],
  "photos:moderate": ["MODERATOR", "ADMIN", "SUPER_ADMIN"],
  "verifications:review": ["MODERATOR", "ADMIN", "SUPER_ADMIN"],
  "payments:read": ["ADMIN", "SUPER_ADMIN"],
  "flags:manage": ["ADMIN", "SUPER_ADMIN"],
  "settings:manage": ["ADMIN", "SUPER_ADMIN"],
  "audit:read": ["ADMIN", "SUPER_ADMIN"],
  "analytics:read": ["MODERATOR", "ADMIN", "SUPER_ADMIN"],
  // Trust & safety: moderators may READ cases/appeals queues; decisions
  // (case review, appeal decisions, enforcement, trust recompute) change
  // what can authenticate/engage, so ADMIN+ only.
  "safety:read": ["MODERATOR", "ADMIN", "SUPER_ADMIN"],
  "safety:manage": ["ADMIN", "SUPER_ADMIN"],
  // Supers-only tier. Role changes and auth diagnostics touch the trust
  // anchor itself, so no delegation below the owner tier.
  "roles:assign": ["SUPER_ADMIN"],
  "diagnostics:view": ["SUPER_ADMIN"],
  // Releasing a number out of a DELETED/orphaned account moves an auth
  // factor between identities - supers only (live-account releases stay
  // under users:manage via the regular release-phone action).
  "phones:release": ["SUPER_ADMIN"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function hasPermission(role: Role | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

/** Any admin-area role - gates the /admin shell and the nav entry point. */
export function isStaff(role: Role | undefined | null): boolean {
  return role === "MODERATOR" || role === "ADMIN" || role === "SUPER_ADMIN";
}

export function isSuperAdmin(role: Role | undefined | null): boolean {
  return role === "SUPER_ADMIN";
}
