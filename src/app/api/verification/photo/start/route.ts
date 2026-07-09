import { apiError, guardRate, ok, requireSession, unauthorized } from "@/lib/api";
import { db } from "@/lib/db";
import {
  getPhotoVerificationProvider,
  VerificationNotConfiguredError,
} from "@/lib/services/photo-verification";

/**
 * POST /api/verification/photo/start - begin a photo verification session.
 *
 * Honest by design: when no provider is configured this is a plain 503
 * "coming soon" - no fake sessions, no pretend progress. When a provider
 * IS configured we persist only its name and the opaque session id
 * (User.photoVerificationProvider/Session + a PENDING Verification row).
 * No biometric data ever touches our database.
 */
export async function POST(req: Request) {
  void req;
  const { user, response } = await requireSession();
  if (response) return response;

  const limited = await guardRate(`verification:photo:${user.id}`, {
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (limited) return limited;

  const me = await db.user.findUnique({
    where: { id: user.id },
    select: { photoVerifiedAt: true },
  });
  if (!me) return unauthorized();
  if (me.photoVerifiedAt) {
    return apiError(409, "already_verified", "Your photo is already verified.");
  }

  const provider = getPhotoVerificationProvider();
  try {
    const session = await provider.start(user.id);
    await db.$transaction([
      db.user.update({
        where: { id: user.id },
        data: {
          photoVerificationProvider: provider.name,
          photoVerificationSession: session.sessionId,
        },
      }),
      db.verification.upsert({
        where: { userId_type: { userId: user.id, type: "PHOTO" } },
        create: {
          userId: user.id,
          type: "PHOTO",
          status: "PENDING",
          provider: provider.name,
          providerSessionId: session.sessionId,
        },
        update: {
          status: "PENDING",
          provider: provider.name,
          providerSessionId: session.sessionId,
          reviewNote: null,
        },
      }),
    ]);
    return ok({ sessionId: session.sessionId, url: session.url ?? null });
  } catch (error) {
    if (error instanceof VerificationNotConfiguredError) {
      return apiError(503, "verification_unavailable", "Photo verification is coming soon.");
    }
    throw error;
  }
}
