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

  // The DEACTIVATED grace window is only meaningful for a COMPLETED account
  // (signing in cancels it, restoring ACTIVE). An account still mid-registration
  // (PENDING, registrationCompletedAt IS NULL) has nothing to preserve and must
  // NOT become DEACTIVATED - that would let a later reactivation set ACTIVE
  // without a completed registration (DB CHECK constraint; L7.3.9). It goes
  // straight to DELETED (the scheduled job hard-deletes; re-registration is a
  // fresh account). This keeps the invariant: DEACTIVATED => registration done.
  const nextStatus = user.registrationCompletedAt ? "DEACTIVATED" : "DELETED";

  await db.$transaction([
    db.user.update({
      where: { id: user.id },
      data: { status: nextStatus, deletionRequested: new Date() },
    }),
    db.profile.updateMany({
      where: { userId: user.id },
      data: { isVisible: false },
    }),
  ]);

  await audit({
    actorId: user.id,
    action: "account.delete_requested",
    targetType: "user",
    targetId: user.id,
  });

  return ok({
    message: "Your account is scheduled for deletion in 30 days. Sign in before then to cancel.",
  });
}
