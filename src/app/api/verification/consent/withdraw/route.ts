import { guardRate, ok, requireSession } from "@/lib/api";
import { withdrawFaceConsent } from "@/lib/services/face-verification";

/**
 * POST /api/verification/consent/withdraw - the owner turns OFF face
 * comparison (biometric consent withdrawal). AUTHENTICATED only; the user
 * id comes from the session (never the body - no arbitrary userId).
 *
 * Runs the canonical withdrawal: mark consent withdrawn, request provider
 * reference deletion (idempotent + retried), drop the reference, idle the
 * job (re-consent must re-enroll), hide the public badge - while leaving
 * the identity verdict (photoVerifiedAt) intact. Idempotent: withdrawing
 * again is a safe 200.
 */
export async function POST() {
  const { user, response } = await requireSession();
  if (response) return response;

  const limited = await guardRate(`verification:consent-withdraw:${user.id}`, {
    limit: 5,
    windowMs: 60 * 1000,
    failMode: "closed",
  });
  if (limited) return limited;

  await withdrawFaceConsent(user.id);
  return ok({ withdrawn: true });
}
