import { db } from "@/lib/db";
import { ipHashFrom, recordAuthEvent, userAgentHashFrom } from "@/lib/auth/audit";
import type { User } from "@/generated/prisma/client";

/**
 * 18+ confirmation and legal consent - the two steps between phone
 * verification and onboarding.
 *
 * Consent is VERSIONED: bumping any entry in CURRENT_VERSIONS makes
 * needsConsent() true again for everyone who accepted an older set, so
 * the gate walks them back through /auth/legal on their next visit.
 * Age confirmation is a one-time fact (you don't un-turn 18).
 */

export const CURRENT_VERSIONS = {
  terms: "2026-07",
  privacy: "2026-07",
  community: "2026-07",
} as const;

export type AgeConsentUser = {
  ageConfirmedAt: Date | null;
  termsVersion: string | null;
  privacyVersion: string | null;
  communityVersion: string | null;
};

/** True until the user has explicitly confirmed they are 18 or older. */
export function needsAgeConfirmation(user: Pick<AgeConsentUser, "ageConfirmedAt">): boolean {
  return !user.ageConfirmedAt;
}

/** True when any accepted version differs from the current set (or was never accepted). */
export function needsConsent(
  user: Pick<AgeConsentUser, "termsVersion" | "privacyVersion" | "communityVersion">,
): boolean {
  return (
    user.termsVersion !== CURRENT_VERSIONS.terms ||
    user.privacyVersion !== CURRENT_VERSIONS.privacy ||
    user.communityVersion !== CURRENT_VERSIONS.community
  );
}

/**
 * Stamp ageConfirmedAt + ageConfirmedIpHash for the user. Idempotent:
 * a second call never moves the original timestamp or rewrites the
 * hash, and only the first transition writes an `age_confirmed` audit
 * event. Returns the (fresh) user row for gate evaluation.
 */
export async function confirmAgeForUser(user: User, req: Request): Promise<User> {
  if (user.ageConfirmedAt) return user;
  const updated = await db.user.update({
    where: { id: user.id },
    data: {
      ageConfirmedAt: new Date(),
      ageConfirmedIpHash: ipHashFrom(req),
    },
  });
  await recordAuthEvent({ type: "age_confirmed", email: user.email, userId: user.id, req });
  return updated;
}

/**
 * Record acceptance of the CURRENT terms/privacy/community versions
 * plus consentAcceptedAt and the request's ip/user-agent hashes.
 * Idempotent: when the user already holds the current versions nothing
 * is rewritten and no duplicate audit row appears. A version bump makes
 * needsConsent() true again, and re-accepting re-stamps everything
 * (new timestamp + hashes = the proof for the NEW versions).
 */
export async function acceptConsentForUser(user: User, req: Request): Promise<User> {
  if (!needsConsent(user)) return user;
  const updated = await db.user.update({
    where: { id: user.id },
    data: {
      termsVersion: CURRENT_VERSIONS.terms,
      privacyVersion: CURRENT_VERSIONS.privacy,
      communityVersion: CURRENT_VERSIONS.community,
      consentAcceptedAt: new Date(),
      consentIpHash: ipHashFrom(req),
      consentUserAgentHash: userAgentHashFrom(req),
    },
  });
  await recordAuthEvent({
    type: "terms_accepted",
    email: user.email,
    userId: user.id,
    req,
    metadata: { versions: CURRENT_VERSIONS },
  });
  return updated;
}
