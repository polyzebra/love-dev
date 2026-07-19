import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { sendSafetyNotice } from "@/lib/services/safety-notices";
import { publicBadgeVisible } from "@/lib/trust/verification-state-machine";
import type { Prisma } from "@/generated/prisma/client";
import type { VerificationStatus, VerificationType } from "@/generated/prisma/enums";

/**
 * CANONICAL verification state - the ONE read path for "is this user
 * email/phone/photo/ID verified" anywhere in the app (profile hero,
 * account page, admin trust panel, badges, trust score).
 *
 * Canon, per channel (verdict lives on User columns; Verification rows
 * are provider WORKFLOW state - pending/in-review/rejected - never the
 * verdict itself):
 *   email  -> User.emailVerified   (DateTime, written by the Supabase
 *             auth webhook / identity sync / email-attach flow)
 *   phone  -> User.phoneVerifiedAt (DateTime, written atomically with
 *             phoneE164 in phone-flow.ts; the legacy User.phoneVerified
 *             boolean-ish column is write-only compatibility - never
 *             read it)
 *   photo  -> User.photoVerifiedAt (DateTime, stamped when a PHOTO
 *             Verification row is APPROVED - see admin reviewVerification)
 *   id     -> Verification(type IDENTITY, status APPROVED) - the only
 *             source that exists; if an idVerifiedAt column ever lands,
 *             swap it in HERE and nowhere else.
 *
 * There are deliberately NO Verification rows for EMAIL/PHONE - those
 * verdicts live on the User columns only. Do not resurrect them.
 *
 * Usage: spread VERIFICATION_USER_SELECT into an existing user select
 * (no extra query) and map with toVerificationState(); use
 * getVerificationState(userId) only when no user query exists yet.
 */

/**
 * PUBLIC badge verdict - the ONE rule for what other members see. ALL must hold:
 *   1. identity verified                  (photoVerifiedAt set)
 *   2. face-badge not suspended           (!faceBadgeSuspendedAt)
 *   3. a verified-gallery snapshot exists  (verifiedGalleryVersion != null)
 *   4. the CURRENT gallery IS that snapshot (verifiedGalleryVersion === galleryVersion)
 *
 * L6.5: (3)+(4) are the integrity lockdown. Every material gallery change
 * increments galleryVersion synchronously (gallery-integrity.ts), so the badge
 * turns off the instant the current gallery diverges from the verified one -
 * with no dependency on the face-match provider, a worker, a cache, or a
 * webhook. (2) still catches face-layer / admin / consent suspensions that are
 * not gallery-version changes.
 */
export function isPubliclyVerified(user: {
  photoVerifiedAt: Date | null;
  // H1: REQUIRED (not optional). A caller that forgets to select these security
  // fields is a COMPILE error, not a silent "verified". Spread
  // PUBLIC_BADGE_SELECT into the query to satisfy them.
  faceBadgeSuspendedAt: Date | null;
  galleryVersion: number;
  verifiedGalleryVersion: number | null;
}): boolean {
  // L6.6: delegates to the ONE canonical resolver. The conjunction itself lives
  // only in publicBadgeVisible() (verification-state-machine.ts) - this function
  // is the app-facing name for it. Nothing recomputes badge logic elsewhere.
  return publicBadgeVisible(user);
}

/**
 * Identity-only public fact (Epic 1 / F1): the account holder passed identity
 * verification. Same semantics as today's photoVerifiedAt check - the future
 * "Identity Verified" badge reads this. Does NOT assert photo-to-face match.
 */
export function isIdentityVerified(user: { photoVerifiedAt: Date | null }): boolean {
  return user.photoVerifiedAt !== null;
}

/**
 * Positive "Photo Verified" grant (Epic 1 / F1). The future public badge that
 * means "these photos are the identity-verified person". INERT in this phase:
 * nothing writes User.faceVerifiedAt yet, so this is false for everyone, and
 * NO UI / list filter / worker / query consumes it. It exists only so later
 * epics have the ONE canonical positive signal to build on. `faceVerifiedAt`
 * is optional so legacy callers that never select it safely read false.
 */
export function isPhotoVerified(user: { faceVerifiedAt?: Date | null }): boolean {
  return user.faceVerifiedAt != null;
}

/**
 * H1 - THE canonical public-badge projection. EVERY surface that renders the
 * public verified badge (swipe, chat, explore, search, public profile, profile
 * peek) MUST spread this into its user select so the badge is always computed
 * from a complete row. It carries EXACTLY the fields the public verdict
 * (isPubliclyVerified) consumes - the identity signal AND the suspension gate.
 * Because isPubliclyVerified() now REQUIRES faceBadgeSuspendedAt, omitting this
 * fragment is a compile error, never a silent "not suspended". (The dormant
 * positive grant faceVerifiedAt is deliberately NOT selected here - it has no
 * public-verdict consumer; see isPhotoVerified.)
 */
export const PUBLIC_BADGE_SELECT = {
  photoVerifiedAt: true,
  faceBadgeSuspendedAt: true,
  // L6.5 gallery-integrity gate: the badge requires the current gallery to be
  // the verified one. Both fields are consumed by isPubliclyVerified(), so this
  // fragment carries them and omitting it is a compile error.
  galleryVersion: true,
  verifiedGalleryVersion: true,
} as const satisfies Prisma.UserSelect;

/** Select fragment - extend an existing user query instead of re-querying. */
export const VERIFICATION_USER_SELECT = {
  emailVerified: true,
  phoneVerifiedAt: true,
  photoVerifiedAt: true,
  faceBadgeSuspendedAt: true,
  verifications: {
    where: { type: { in: ["PHOTO", "IDENTITY"] } },
    select: { type: true, status: true, updatedAt: true },
  },
} as const satisfies Prisma.UserSelect;

/** Minimal user shape the mapper needs (full rows satisfy it too). */
export type VerificationSource = {
  emailVerified: Date | null;
  phoneVerifiedAt: Date | null;
  photoVerifiedAt: Date | null;
  /** Face-layer badge suspension - withholds the photo badge without
   *  un-verifying identity (see face-verification.ts). H1: REQUIRED (no
   *  optional security fields) - VERIFICATION_USER_SELECT always loads it, so
   *  a caller that omits it is a compile error, never a silent "not suspended". */
  faceBadgeSuspendedAt: Date | null;
  verifications: Array<{
    type: VerificationType;
    status: VerificationStatus;
    updatedAt: Date;
  }>;
};

export type VerificationState = {
  emailVerified: boolean;
  emailVerifiedAt: Date | null;
  phoneVerified: boolean;
  phoneVerifiedAt: Date | null;
  photoVerified: boolean;
  photoVerifiedAt: Date | null;
  /** Identity verified but the photo badge is withheld by the face layer -
   *  the profile photos changed and need re-checking. The user must re-verify
   *  their photos to restore the badge; identity itself is intact. */
  requiresReverification: boolean;
  /** Provider/review workflow state for photo ("In review" copy) - not the verdict. */
  photoStatus: VerificationStatus | null;
  idVerified: boolean;
  idVerifiedAt: Date | null;
  idStatus: VerificationStatus | null;
  /** 0-100, derived from the four verdicts with TRUST_WEIGHTS - never stored. */
  trustScore: number;
};

/** Single place the trust-score weighting lives (sums to 100). */
export const TRUST_WEIGHTS = { email: 25, phone: 25, photo: 35, id: 15 } as const;

/**
 * Prisma where-clause for "photo verified" in list/filter queries - the
 * SAME rule as isPubliclyVerified: identity verified AND the face badge not
 * suspended. A suspended badge must never surface as verified in any list.
 */
export const PHOTO_VERIFIED_WHERE = {
  photoVerifiedAt: { not: null },
  faceBadgeSuspendedAt: null,
} as const satisfies Prisma.UserWhereInput;

/** Pure mapper - the only place verification verdicts are derived. */
export function toVerificationState(user: VerificationSource): VerificationState {
  const photoRow = user.verifications.find((v) => v.type === "PHOTO") ?? null;
  const idRow = user.verifications.find((v) => v.type === "IDENTITY") ?? null;

  const emailVerified = user.emailVerified !== null;
  const phoneVerified = user.phoneVerifiedAt !== null;
  // The PUBLIC photo badge = identity verified AND the face layer has not
  // suspended it. A suspended badge is NOT "photo verified" on any surface -
  // owner profile, account page, admin panel and list filters all agree.
  const identityPhotoVerified = user.photoVerifiedAt !== null;
  const badgeSuspended = user.faceBadgeSuspendedAt != null;
  const photoVerified = identityPhotoVerified && !badgeSuspended;
  const requiresReverification = identityPhotoVerified && badgeSuspended;
  const idVerified = idRow?.status === "APPROVED";

  const trustScore =
    (emailVerified ? TRUST_WEIGHTS.email : 0) +
    (phoneVerified ? TRUST_WEIGHTS.phone : 0) +
    (photoVerified ? TRUST_WEIGHTS.photo : 0) +
    (idVerified ? TRUST_WEIGHTS.id : 0);

  return {
    emailVerified,
    emailVerifiedAt: user.emailVerified,
    phoneVerified,
    phoneVerifiedAt: user.phoneVerifiedAt,
    photoVerified,
    photoVerifiedAt: user.photoVerifiedAt,
    requiresReverification,
    photoStatus: photoRow?.status ?? null,
    idVerified,
    idVerifiedAt: idVerified ? (idRow?.updatedAt ?? null) : null,
    idStatus: idRow?.status ?? null,
    trustScore,
  };
}

/** Convenience accessor when no user query is already in flight. */
export async function getVerificationState(userId: string): Promise<VerificationState | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: VERIFICATION_USER_SELECT,
  });
  return user ? toVerificationState(user) : null;
}

/**
 * Staff verdict on a verification request (admin review queue). Routes
 * own the permission checks (requirePermission) - this owns the mutation.
 * The verdict lives on User columns (see above): a PHOTO review must
 * stamp/clear User.photoVerifiedAt atomically with the row update or the
 * badge surfaces and the review queue would disagree. The owner is
 * notified through the notification outbox (in-app + push + email per
 * prefs) and the decision lands in AdminLog.
 */
export async function reviewVerification(opts: {
  actorId: string;
  verificationId: string;
  approve: boolean;
}): Promise<{ userId: string; type: VerificationType; status: VerificationStatus }> {
  const verification = await db.$transaction(async (tx) => {
    const row = await tx.verification.update({
      where: { id: opts.verificationId },
      data: {
        status: opts.approve ? "APPROVED" : "REJECTED",
        statusChangedAt: new Date(),
        reviewedById: opts.actorId,
      },
    });
    if (row.type === "PHOTO") {
      await tx.user.update({
        where: { id: row.userId },
        data: { photoVerifiedAt: opts.approve ? new Date() : null },
      });
      // L6.5: a staff approval is a deliberate verdict on the CURRENT gallery -
      // stamp the verified-gallery snapshot so the badge turns on against
      // exactly these photos. Any later material change re-invalidates it.
      if (opts.approve) {
        const { snapshotVerifiedGallery } = await import("@/lib/services/gallery-integrity");
        await snapshotVerifiedGallery(tx, row.userId);
      }
    }
    return row;
  });
  // H3: revoking identity (PHOTO reject -> photoVerifiedAt cleared above) must
  // revoke the dependent Photo Verified grant through the canonical engine - no
  // stale positive grant may outlive its identity precondition. Runs AFTER the
  // committed revocation; a no-op when nothing was granted. Dynamic import
  // avoids the photo-grant <-> service import cycle.
  if (verification.type === "PHOTO" && !opts.approve) {
    const { clearPhotoVerification, PhotoClearReason } = await import("@/lib/services/photo-grant");
    await clearPhotoVerification(verification.userId, PhotoClearReason.IDENTITY_REVOKED, {
      actorType: "admin",
      actorId: opts.actorId,
    }).catch(() => undefined);
  }
  await sendSafetyNotice(
    verification.userId,
    opts.approve ? "verification_approved" : "verification_rejected",
    `verification:${opts.verificationId}:${opts.approve ? "approved" : "rejected"}:staff`,
    { verificationId: opts.verificationId },
  );
  await audit({
    actorId: opts.actorId,
    action: `verification.${opts.approve ? "approve" : "reject"}`,
    targetType: "verification",
    targetId: opts.verificationId,
  });
  return { userId: verification.userId, type: verification.type, status: verification.status };
}
