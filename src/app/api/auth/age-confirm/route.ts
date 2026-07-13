import { db } from "@/lib/db";
import { requireSession, withUnavailableGuard, authOk, authError } from "@/lib/api";
import { confirmAgeForUser } from "@/lib/auth/consent";
import { authNextStep } from "@/lib/auth/gate";

/**
 * POST /api/auth/age-confirm {} -> { ok: true, next }
 *
 * Stamps ageConfirmedAt + ageConfirmedIpHash (salted hash - the raw IP
 * is never stored) for the signed-in user and records an
 * `age_confirmed` audit event. Idempotent: repeat calls keep the
 * original timestamp/hash and just re-answer with the gate's next step.
 */
export const POST = withUnavailableGuard("auth:age-confirm", async (req: Request) => {
  const { user: sessionUser, response } = await requireSession();
  if (response) return response;

  // Fresh full row - the session shape doesn't carry consent fields and
  // the gate needs all of them to compute `next`.
  const user = await db.user.findUnique({ where: { id: sessionUser.id } });
  if (!user) return authError(401, "unauthorized", "Sign in to continue.");

  if (user.bannedAt || user.status === "SUSPENDED") {
    return authError(403, "account_restricted", "This account is restricted.", {
      next: "/account-blocked",
    });
  }

  const updated = await confirmAgeForUser(user, req);
  return authOk({ next: authNextStep(updated) });
});
