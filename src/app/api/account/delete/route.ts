import { ok, requireSession } from "@/lib/api";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

/**
 * GDPR account deletion (Art. 17 - right to erasure).
 * Marks the account for deletion with a 30-day grace window, hides the
 * profile immediately and revokes all sessions. A scheduled job performs
 * the hard delete after the window (cascades cover related rows).
 */
export async function POST() {
  const { user, response } = await requireSession();
  if (response) return response;

  await db.$transaction([
    db.user.update({
      where: { id: user.id },
      data: { status: "DEACTIVATED", deletionRequested: new Date() },
    }),
    db.profile.updateMany({
      where: { userId: user.id },
      data: { isVisible: false },
    }),
    db.session.deleteMany({ where: { userId: user.id } }),
  ]);

  await audit({
    actorId: user.id,
    action: "account.delete_requested",
    targetType: "user",
    targetId: user.id,
  });

  return ok({
    message:
      "Your account is scheduled for deletion in 30 days. Sign in before then to cancel.",
  });
}
