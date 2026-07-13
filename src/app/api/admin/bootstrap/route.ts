import { createHash, timingSafeEqual } from "node:crypto";
import { apiError, clientIp, guardRate, ok } from "@/lib/api";
import { bootstrapSuperAdmin } from "@/lib/services/admin-bootstrap";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/bootstrap - one-time SUPER_ADMIN bootstrap (online path;
 * scripts/bootstrap-admin.ts is the preferred offline path). No session:
 * the caller proves control of the deployment via the server-only
 * ADMIN_BOOTSTRAP_SECRET header instead.
 *
 * Contract (all guards live in src/lib/services/admin-bootstrap.ts):
 *   401  missing/wrong x-bootstrap-secret, or the secret env is unset
 *   503  ADMIN_BOOTSTRAP_EMAIL not configured
 *   410  a SUPER_ADMIN already exists (mechanism auto-disabled; idempotent)
 *   409  app user missing / email unverified / not ACTIVE - the body
 *        carries the exact setup instructions (spec PART 13)
 *   200  promoted - AdminLog "admin.bootstrap" + AuthVerificationEvent written
 */

/** Constant-time compare over digests so length never leaks. */
function secretMatches(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  // Small IP window to make secret guessing pointless.
  const limited = await guardRate(`admin-bootstrap:${clientIp(req)}`, {
    limit: 5,
    windowMs: 10 * 60_000,
  });
  if (limited) return limited;

  if (!secretMatches(req.headers.get("x-bootstrap-secret"), process.env.ADMIN_BOOTSTRAP_SECRET)) {
    return apiError(401, "unauthorized", "Invalid bootstrap credentials.");
  }
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL;
  if (!email || email.trim().length === 0) {
    return apiError(
      503,
      "not_configured",
      "ADMIN_BOOTSTRAP_EMAIL is not configured on the server.",
    );
  }

  const result = await bootstrapSuperAdmin({ email, via: "api", req });
  switch (result.status) {
    case "gone":
      return apiError(
        410,
        "gone",
        "Bootstrap already completed - a SUPER_ADMIN exists. This endpoint is permanently disabled.",
      );
    case "setup_required":
      return apiError(
        409,
        result.reason,
        `The bootstrap account is not ready (${result.reason.replace(/_/g, " ")}). Complete the setup steps, then retry.`,
        { instructions: [...result.instructions] },
      );
    case "promoted":
      return ok({ promoted: true, userId: result.userId });
  }
}
