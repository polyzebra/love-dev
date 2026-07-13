import { db } from "@/lib/db";
import { requireSession, withUnavailableGuard, authOk, authError } from "@/lib/api";
import { acceptConsentForUser } from "@/lib/auth/consent";
import { authNextStep } from "@/lib/auth/gate";

/**
 * POST /api/auth/consent {} -> { ok: true, next }
 *
 * Records acceptance of the CURRENT Terms / Privacy / Community
 * Guidelines versions: all three version strings plus consentAcceptedAt
 * and salted ip/user-agent hashes (never the raw values), with a
 * `terms_accepted` audit event. Idempotent while the versions match;
 * after a version bump the gate sends the user back here and a new
 * acceptance is stamped in full.
 */
export const POST = withUnavailableGuard("auth:consent", async (req: Request) => {
  const { user: sessionUser, response } = await requireSession();
  if (response) return response;

  const user = await db.user.findUnique({ where: { id: sessionUser.id } });
  if (!user) return authError(401, "unauthorized", "Sign in to continue.");

  if (user.bannedAt || user.status === "SUSPENDED") {
    return authError(403, "account_restricted", "This account is restricted.", {
      next: "/account-blocked",
    });
  }

  const updated = await acceptConsentForUser(user, req);
  return authOk({ next: authNextStep(updated) });
});
