import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession, withUnavailableGuard } from "@/lib/api";
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
  if (!user)
    return NextResponse.json({ ok: false, error: "Sign in to continue." }, { status: 401 });

  if (user.bannedAt || user.status === "SUSPENDED") {
    return NextResponse.json({ ok: false, next: "/account-blocked" }, { status: 403 });
  }

  const updated = await acceptConsentForUser(user, req);
  return NextResponse.json({ ok: true, next: authNextStep(updated) });
});
