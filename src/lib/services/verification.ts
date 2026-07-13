import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { sendSafetyNotice } from "@/lib/services/safety-notices";
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

/** Select fragment - extend an existing user query instead of re-querying. */
export const VERIFICATION_USER_SELECT = {
  emailVerified: true,
  phoneVerifiedAt: true,
  photoVerifiedAt: true,
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

/** Prisma where-clause for "photo verified" in list/filter queries. */
export const PHOTO_VERIFIED_WHERE = {
  photoVerifiedAt: { not: null },
} as const satisfies Prisma.UserWhereInput;

/** Pure mapper - the only place verification verdicts are derived. */
export function toVerificationState(user: VerificationSource): VerificationState {
  const photoRow = user.verifications.find((v) => v.type === "PHOTO") ?? null;
  const idRow = user.verifications.find((v) => v.type === "IDENTITY") ?? null;

  const emailVerified = user.emailVerified !== null;
  const phoneVerified = user.phoneVerifiedAt !== null;
  const photoVerified = user.photoVerifiedAt !== null;
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
        reviewedById: opts.actorId,
      },
    });
    if (row.type === "PHOTO") {
      await tx.user.update({
        where: { id: row.userId },
        data: { photoVerifiedAt: opts.approve ? new Date() : null },
      });
    }
    return row;
  });
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
