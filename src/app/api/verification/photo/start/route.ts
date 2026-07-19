import { apiError, guardRate, ok, requireSession, unauthorized } from "@/lib/api";
import { db } from "@/lib/db";
import {
  describeProviderSession,
  getPhotoVerificationProvider,
  VerificationNotConfiguredError,
} from "@/lib/services/photo-verification";

/**
 * POST /api/verification/photo/start - begin OR resume a photo
 * verification session.
 *
 * Honest by design: when no provider is configured this is a plain 503
 * "coming soon" - no fake sessions, no pretend progress. When a provider
 * IS configured we persist only its name and the opaque session id
 * (User.photoVerificationProvider/Session + a PENDING Verification row).
 * No biometric data ever touches our database.
 *
 * SESSION REUSE: if the user already has an OPEN session at the provider
 * (Stripe requires_input/processing - our "pending"), we return that
 * session's still-active hosted URL instead of creating a duplicate
 * VerificationSession. A new session is created only when none exists or
 * the previous one reached a terminal state (canceled/expired/rejected).
 */
export async function POST(req: Request) {
  void req;
  const { user, response } = await requireSession();
  if (response) return response;

  const limited = await guardRate(`verification:photo:${user.id}`, {
    limit: 5,
    windowMs: 60 * 60 * 1000,
    // Fail-closed: each start can hit a paid provider - never unmetered.
    failMode: "closed",
  });
  if (limited) return limited;

  const me = await db.user.findUnique({
    where: { id: user.id },
    select: { photoVerifiedAt: true, galleryVersion: true },
  });
  if (!me) return unauthorized();
  if (me.photoVerifiedAt) {
    return apiError(409, "already_verified", "Your photo is already verified.");
  }

  const provider = getPhotoVerificationProvider();

  // Reuse before create: an open session at the provider is resumable.
  const existing = await db.verification.findUnique({
    where: { userId_type: { userId: user.id, type: "PHOTO" } },
    select: { status: true, provider: true, providerSessionId: true },
  });
  if (
    existing?.status === "PENDING" &&
    existing.provider === provider.name &&
    existing.providerSessionId
  ) {
    try {
      const detail = await describeProviderSession(provider, existing.providerSessionId);
      if (detail.status === "pending") {
        // Still open - hand back the SAME session (and its live hosted
        // URL when the provider has one). Nothing is created or written.
        return ok({
          sessionId: existing.providerSessionId,
          url: detail.url,
          reused: true,
        });
      }
      // Terminal at the provider - fall through and create a fresh one.
    } catch {
      // Describe hiccups must not block starting: fall through to create,
      // exactly what this endpoint did before reuse existed.
    }
  }

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
          statusChangedAt: new Date(),
          provider: provider.name,
          providerSessionId: session.sessionId,
          // L6.5 Phase H: pin the gallery version at session start. Approval
          // restores the badge only if the gallery is unchanged since here.
          galleryVersionAtStart: me.galleryVersion,
        },
        update: {
          status: "PENDING",
          statusChangedAt: new Date(),
          provider: provider.name,
          providerSessionId: session.sessionId,
          reviewNote: null,
          lastReconciledAt: null,
          galleryVersionAtStart: me.galleryVersion,
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
