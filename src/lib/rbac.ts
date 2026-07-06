import type { Role } from "@/generated/prisma/enums";

/**
 * Role-based access control. Permissions are explicit - least privilege -
 * so a new capability must be added here before any route can use it.
 */
export const PERMISSIONS = {
  "users:read": ["MODERATOR", "ADMIN"],
  "users:suspend": ["MODERATOR", "ADMIN"],
  "users:delete": ["ADMIN"],
  "reports:read": ["MODERATOR", "ADMIN"],
  "reports:resolve": ["MODERATOR", "ADMIN"],
  "photos:moderate": ["MODERATOR", "ADMIN"],
  "verifications:review": ["MODERATOR", "ADMIN"],
  "payments:read": ["ADMIN"],
  "flags:manage": ["ADMIN"],
  "settings:manage": ["ADMIN"],
  "audit:read": ["ADMIN"],
  "analytics:read": ["MODERATOR", "ADMIN"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function hasPermission(role: Role | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export function isStaff(role: Role | undefined | null): boolean {
  return role === "MODERATOR" || role === "ADMIN";
}
