import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { sendSafetyNotice } from "@/lib/services/safety-notices";
import {
  publicBadgeVisible,
  publicBadgePerPhotoVisible,
  perPhotoBadgeReason,
  type TrustFacts,
  type PerPhotoBadgeFacts,
  type PerPhotoBadgeReason,
  type PerPhotoCheckFact,
  type RequiredPhotoFact,
} from "@/lib/trust/verification-state-machine";
import { userInPercentCohort, faceEmergencyDisabled } from "@/lib/services/face-rollout";
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

// ---------------------------------------------------------------------------
// L6.12/L6.13 - per-photo badge contract dispatcher + cohort (non-destructive).
// Non-cohort users ALWAYS use the existing whole-gallery resolver, byte-for-
// byte. Only a canary-cohort user uses the per-photo predicate. A single global
// boolean can NEVER move all users (cohort membership requires an explicit
// allowlist entry or a deliberately-set percentage). No surface is rewired
// here; adoption is a canary-time action (see the L6.13 adoption map).
// ---------------------------------------------------------------------------

/** Master on/off. Necessary but NOT sufficient - cohort membership still gates. */
export function perPhotoBadgeEnabled(): boolean {
  return process.env.FACE_BADGE_PER_PHOTO === "1";
}

/**
 * Project the four badge base facts off any already-loaded user row (the same
 * fields PUBLIC_BADGE_SELECT carries). Surfaces pass this to the dispatcher -
 * they never inspect the raw badge columns themselves (Trust Contract).
 */
export function toTrustFacts(u: {
  photoVerifiedAt: Date | null;
  faceBadgeSuspendedAt: Date | null;
  galleryVersion: number;
  verifiedGalleryVersion: number | null;
}): TrustFacts {
  return {
    photoVerifiedAt: u.photoVerifiedAt,
    faceBadgeSuspendedAt: u.faceBadgeSuspendedAt,
    galleryVersion: u.galleryVersion,
    verifiedGalleryVersion: u.verifiedGalleryVersion,
  };
}

/**
 * Cohort-safe canary membership for the per-photo badge contract (Phase E).
 * A user is in the canary IFF: the master flag is on, the emergency switch is
 * off, AND (they are on the explicit stable-id allowlist OR fall inside the
 * deterministic percentage bucket). Default off: no allowlist + percent 0/unset
 * => nobody. A global env boolean alone can never enrol everyone.
 */
export function perPhotoBadgeCohort(userId: string): boolean {
  if (!perPhotoBadgeEnabled()) return false; // master off -> legacy for all
  if (faceEmergencyDisabled()) return false; // emergency -> fail closed
  const id = userId?.trim();
  if (!id) return false;
  const allow = (process.env.FACE_BADGE_PER_PHOTO_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.includes("@")); // stable ids only, never emails
  if (allow.includes(id)) return true;
  const pct = Number(process.env.FACE_BADGE_PER_PHOTO_PERCENT);
  if (Number.isFinite(pct) && pct > 0) return userInPercentCohort(id, pct);
  return false;
}

/**
 * PURE data-driven dispatcher (Phase D). `perPhoto` present -> the canonical
 * per-photo predicate; `perPhoto` null -> the existing whole-gallery resolver
 * (unchanged). Cohort/flag selection lives in resolveBadgeVisibleForUser and
 * batch callers, which decide whether to assemble per-photo facts at all.
 */
export function resolveBadgeVisible(
  base: TrustFacts,
  perPhoto: PerPhotoBadgeFacts | null,
): boolean {
  return perPhoto ? publicBadgePerPhotoVisible(perPhoto) : publicBadgeVisible(base);
}

/**
 * THE cohort-aware single-user badge entry. Non-cohort users get the existing
 * whole-gallery verdict (byte-identical). A canary user gets the per-photo
 * predicate, FAILING CLOSED (no badge) only for THEM if the facts cannot be
 * assembled. Never falls a canary user back to the weaker legacy contract.
 */
export async function resolveBadgeVisibleForUser(
  userId: string,
  base: TrustFacts,
): Promise<boolean> {
  if (!perPhotoBadgeCohort(userId)) return publicBadgeVisible(base);
  const facts = await getPerPhotoBadgeFacts(userId);
  return facts ? publicBadgePerPhotoVisible(facts) : false;
}

/**
 * Per-photo badge STATE for a canary user (Phase G): visibility + a coarse
 * machine reason for internal diagnostics / one safe user-facing action. No
 * biometric data. Non-cohort users report the legacy visibility with no reason.
 */
export async function resolveBadgeStateForUser(
  userId: string,
  base: TrustFacts,
): Promise<{ visible: boolean; reason: PerPhotoBadgeReason; cohort: boolean }> {
  if (!perPhotoBadgeCohort(userId)) {
    return { visible: publicBadgeVisible(base), reason: "LEGACY_VISIBLE", cohort: false };
  }
  const facts = await getPerPhotoBadgeFacts(userId);
  if (!facts) return { visible: false, reason: "REFERENCE_REQUIRED", cohort: true };
  return {
    visible: publicBadgePerPhotoVisible(facts),
    reason: perPhotoBadgeReason(facts),
    cohort: true,
  };
}

/**
 * Minimal read surface the batch assembler needs. `db` satisfies it at runtime;
 * tests inject a counting fake to prove the bounded query count.
 */
export type BadgeBatchClient = {
  user: {
    findMany(
      a: unknown,
    ): Promise<{ id: string; photoVerifiedAt: Date | null; faceBadgeSuspendedAt: Date | null }[]>;
  };
  profilePhotoVerification: {
    findMany(a: unknown): Promise<
      {
        id: string;
        userId: string;
        referenceId: string | null;
        referenceVersion: number | null;
        referenceStatus: string | null;
      }[]
    >;
  };
  photo: {
    findMany(
      a: unknown,
    ): Promise<{ id: string; userId: string; mediaVersion: number; isCover: boolean }[]>;
  };
  photoFaceCheck: {
    findMany(a: unknown): Promise<
      {
        verificationId: string;
        photoId: string;
        photoVersion: number;
        referenceVersion: number | null;
        isCoverAtCheck: boolean;
        decision: string;
      }[]
    >;
  };
};

const ckey = (verificationId: string, photoId: string, version: number) =>
  `${verificationId} ${photoId} ${version}`;

/**
 * THE canonical BATCH per-photo fact assembler (L6.14 Phase A). REUSES the
 * existing pipeline data. Query plan: a CONSTANT 4 queries (user, verification,
 * ACTIVE photos, PhotoFaceCheck) via `IN (...)` - independent of userCount, NO
 * per-user query, NO N+1. The 4th is skipped when there is nothing to load (<=4
 * total). Deterministic keyed mapping; returns one entry per requested user
 * (null for a missing user). Exactly one check exists per
 * (photoId, mediaVersion, verificationId) (unique key) -> an older PASSED can
 * never shadow a current failure. Selects only predicate fields - no similarity
 * / quality / manipulation scores reach this layer.
 */
export async function getPerPhotoBadgeFactsForUsers(
  userIds: string[],
  client: BadgeBatchClient = db as unknown as BadgeBatchClient,
): Promise<Map<string, PerPhotoBadgeFacts | null>> {
  const ids = [...new Set(userIds.filter((id) => id && id.trim().length > 0))];
  const out = new Map<string, PerPhotoBadgeFacts | null>();
  if (ids.length === 0) return out;

  // Query 1-3 (parallel, IN-scoped).
  const [users, jobs, photos] = await Promise.all([
    client.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, photoVerifiedAt: true, faceBadgeSuspendedAt: true },
    }),
    client.profilePhotoVerification.findMany({
      where: { userId: { in: ids } },
      select: {
        id: true,
        userId: true,
        referenceId: true,
        referenceVersion: true,
        referenceStatus: true,
      },
    }),
    client.photo.findMany({
      where: { userId: { in: ids }, status: "ACTIVE" },
      select: { id: true, userId: true, mediaVersion: true, isCover: true },
    }),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  const jobByUser = new Map(jobs.map((j) => [j.userId, j]));
  const jobIdByUser = new Map(jobs.map((j) => [j.userId, j.id]));
  const photosByUser = new Map<string, typeof photos>();
  for (const p of photos) {
    const arr = photosByUser.get(p.userId);
    if (arr) arr.push(p);
    else photosByUser.set(p.userId, [p]);
  }

  // Query 4 (scoped to the loaded jobs + current photos), skipped if nothing.
  const jobIds = jobs.map((j) => j.id);
  const photoIds = photos.map((p) => p.id);
  const checks =
    jobIds.length > 0 && photoIds.length > 0
      ? await client.photoFaceCheck.findMany({
          where: { verificationId: { in: jobIds }, photoId: { in: photoIds } },
          select: {
            verificationId: true,
            photoId: true,
            photoVersion: true,
            referenceVersion: true,
            isCoverAtCheck: true,
            decision: true,
          },
        })
      : [];
  const checkByKey = new Map(
    checks.map((c) => [ckey(c.verificationId, c.photoId, c.photoVersion), c]),
  );

  for (const uid of ids) {
    const u = userById.get(uid);
    if (!u) {
      out.set(uid, null);
      continue;
    }
    const job = jobByUser.get(uid);
    const jobId = jobIdByUser.get(uid);
    const referenceCurrent =
      job?.referenceId != null &&
      (job.referenceStatus === "ACTIVE" || job.referenceStatus === "EXPIRING");
    const requiredPhotos: RequiredPhotoFact[] = (photosByUser.get(uid) ?? []).map((p) => {
      const c = jobId ? checkByKey.get(ckey(jobId, p.id, p.mediaVersion)) : undefined;
      return {
        photoId: p.id,
        mediaVersion: p.mediaVersion,
        isCover: p.isCover,
        check: c
          ? {
              photoId: c.photoId,
              photoVersion: c.photoVersion,
              referenceVersion: c.referenceVersion, // persisted stamp (null legacy -> fails closed)
              isCoverAtCheck: c.isCoverAtCheck,
              decision: c.decision as PerPhotoCheckFact["decision"],
            }
          : null,
      };
    });
    out.set(uid, {
      photoVerifiedAt: u.photoVerifiedAt,
      faceBadgeSuspendedAt: u.faceBadgeSuspendedAt,
      currentReferenceId: referenceCurrent ? job!.referenceId : null,
      currentReferenceVersion: referenceCurrent ? (job!.referenceVersion ?? null) : null,
      requiredPhotos,
    });
  }
  return out;
}

/** Single-user convenience: delegates to the ONE canonical batch assembler. */
export async function getPerPhotoBadgeFacts(userId: string): Promise<PerPhotoBadgeFacts | null> {
  return (await getPerPhotoBadgeFactsForUsers([userId])).get(userId) ?? null;
}

/**
 * THE canonical BATCH badge dispatcher (L6.14 Phase B). Partitions by cohort:
 * non-canary users resolve from their legacy base facts (NO per-photo assembly);
 * only the canary subset triggers ONE batch fact load. A canary user whose facts
 * are missing fails closed for THEM alone - one bad user never fails the batch.
 * Returns a keyed map { visible, reason } with stable per-user results
 * (page-position independent).
 */
export async function resolveBadgeVisibleForUsers(
  userIds: string[],
  baseById: Map<string, TrustFacts>,
  client: BadgeBatchClient = db as unknown as BadgeBatchClient,
): Promise<Map<string, { visible: boolean; reason: PerPhotoBadgeReason }>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  const out = new Map<string, { visible: boolean; reason: PerPhotoBadgeReason }>();
  const canary = ids.filter((id) => perPhotoBadgeCohort(id));
  const facts = canary.length > 0 ? await getPerPhotoBadgeFactsForUsers(canary, client) : new Map();
  const canarySet = new Set(canary);
  for (const id of ids) {
    if (!canarySet.has(id)) {
      const base = baseById.get(id);
      out.set(id, { visible: base ? publicBadgeVisible(base) : false, reason: "LEGACY_VISIBLE" });
      continue;
    }
    const f = (facts.get(id) as PerPhotoBadgeFacts | null | undefined) ?? null;
    out.set(
      id,
      f
        ? { visible: publicBadgePerPhotoVisible(f), reason: perPhotoBadgeReason(f) }
        : { visible: false, reason: "REFERENCE_REQUIRED" },
    );
  }
  return out;
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
 * Positive "Photo Verified" grant. The AWS-backed signal meaning "these photos
 * are the identity-verified person". `faceVerifiedAt` IS written in production
 * by the canonical grant engine (photo-grant.ts grantPhotoVerification), once
 * the face layer is CONFIGURED (FACE_MATCH_PROVIDER + legal gates) and the full
 * chain completes (liveness -> reference -> BOUND binding -> cover match). While
 * the layer is unconfigured it stays NULL (fail-closed), so this reads false.
 *
 * NOTE (badge-enforcement gap): the current public badge resolver
 * (publicBadgeVisible / isPubliclyVerified) does NOT yet consume this - it still
 * grants on Stripe photoVerifiedAt + gallery snapshot. Wiring the badge to
 * require faceVerifiedAt is a deploy-gated change (see L6.11 Phase F).
 * `faceVerifiedAt` is optional so legacy callers that never select it read false.
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
