import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession, withUnavailableGuard } from "@/lib/api";
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
  if (!user)
    return NextResponse.json({ ok: false, error: "Sign in to continue." }, { status: 401 });

  if (user.bannedAt || user.status === "SUSPENDED") {
    return NextResponse.json({ ok: false, next: "/account-blocked" }, { status: 403 });
  }

  const updated = await confirmAgeForUser(user, req);
  return NextResponse.json({ ok: true, next: authNextStep(updated) });
});
