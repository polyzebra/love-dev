import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { recordAuthEvent } from "@/lib/auth/audit";

/**
 * One-time SUPER_ADMIN bootstrap - the ONLY way a role is ever granted
 * outside an existing SUPER_ADMIN session (rbac "roles:assign"). Shared
 * by POST /api/admin/bootstrap (secret-header path) and
 * scripts/bootstrap-admin.ts (preferred offline path); both funnel every
 * decision through here so the guards cannot drift.
 *
 * Safety properties:
 *  - Auto-disabling: if ANY SUPER_ADMIN exists the whole mechanism is
 *    dead ("gone", HTTP 410) - success therefore disables it, and the
 *    same guard makes retries idempotent.
 *  - Promotes only a pre-existing, email-verified, ACTIVE app User found
 *    by normalized email. It never creates accounts and never touches
 *    Supabase auth - the human must complete the normal signup first
 *    (see SETUP_INSTRUCTIONS), so the promoted row is a real, working
 *    login keyed by its auth uid.
 *  - Fully audited: AdminLog "admin.bootstrap" + an AuthVerificationEvent.
 */

/** Setup steps returned on 409 (user missing/unverified) - spec PART 13 UX. */
export const SETUP_INSTRUCTIONS: readonly string[] = [
  "1. Open the production site and go to /login.",
  "2. Sign in with the bootstrap email (email code, or Google if it uses that address) - this creates the app account.",
  "3. Enter the one-time code sent to the inbox to verify the email.",
  "4. Complete the required steps (age confirmation, terms) until the app opens.",
  "5. In Settings -> Account & verification, confirm the email shows as verified.",
  "6. Re-run the bootstrap: npx tsx scripts/bootstrap-admin.ts (preferred), or POST /api/admin/bootstrap with the x-bootstrap-secret header.",
  "7. Sign out and back in, then open /admin - the account is SUPER_ADMIN.",
];

/** Same normalization the auth flows use for email identity: trim + lowercase. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export type BootstrapResult =
  /** A SUPER_ADMIN already exists - mechanism permanently disabled. */
  | { status: "gone" }
  /** The app User is missing or not ready - do the setup steps first. */
  | {
      status: "setup_required";
      reason: "user_not_found" | "email_unverified" | "account_not_active";
      email: string;
      instructions: readonly string[];
    }
  | { status: "promoted"; userId: string; email: string };

export async function bootstrapSuperAdmin(opts: {
  /** Raw bootstrap email (normalized here). */
  email: string;
  via: "api" | "script";
  req?: Request;
}): Promise<BootstrapResult> {
  const email = normalizeEmail(opts.email);

  // Idempotency + auto-disable: one SUPER_ADMIN anywhere kills the path.
  const existing = await db.user.count({ where: { role: "SUPER_ADMIN" } });
  if (existing > 0) return { status: "gone" };

  const user = await db.user.findFirst({
    where: { email, status: { not: "DELETED" } },
    select: { id: true, email: true, emailVerified: true, status: true, role: true },
  });
  if (!user) {
    return {
      status: "setup_required",
      reason: "user_not_found",
      email,
      instructions: SETUP_INSTRUCTIONS,
    };
  }
  if (!user.emailVerified) {
    return {
      status: "setup_required",
      reason: "email_unverified",
      email,
      instructions: SETUP_INSTRUCTIONS,
    };
  }
  if (user.status !== "ACTIVE") {
    return {
      status: "setup_required",
      reason: "account_not_active",
      email,
      instructions: SETUP_INSTRUCTIONS,
    };
  }

  await db.user.update({ where: { id: user.id }, data: { role: "SUPER_ADMIN" } });
  await audit({
    actorId: user.id,
    action: "admin.bootstrap",
    targetType: "user",
    targetId: user.id,
    metadata: { via: opts.via, email, previousRole: user.role },
  });
  await recordAuthEvent({
    type: "admin_bootstrap",
    email,
    userId: user.id,
    req: opts.req,
    metadata: { via: opts.via },
  });
  return { status: "promoted", userId: user.id, email };
}
