import { db } from "@/lib/db";
import { FIRST_MESSAGE_LIMITS, SWIPE_LIMITS } from "@/lib/constants";
import type { PlanTier, SubscriptionStatus } from "@/generated/prisma/enums";

/**
 * Canonical entitlements - the ONLY place a Subscription row becomes
 * product capability. Derived exclusively from persisted, Stripe-verified
 * state (services/billing.ts writes it); nothing client-supplied ever
 * reaches this module.
 *
 * Status policy (Stripe-conventional):
 *  - ACTIVE / TRIALING        -> paid tier applies
 *  - ACTIVE + cancelAtPeriodEnd -> STILL the paid tier: Stripe keeps the
 *    subscription active until period end, then sends
 *    customer.subscription.deleted which drops the row to FREE
 *  - PAST_DUE                 -> paid tier kept during a short dunning
 *    grace window (Stripe retries the payment); after the grace the plan
 *    reads FREE even before the UNPAID/CANCELED webhook lands
 *  - everything else (CHECKOUT_PENDING, INCOMPLETE, INCOMPLETE_EXPIRED,
 *    UNPAID, PAUSED, CANCELED, EXPIRED) -> FREE
 *
 * HONESTY RULE: only capabilities that exist in the product today are
 * exposed. Boosts, see-who-liked, priority discovery and premium filters
 * have NO mechanism in the codebase yet - they are deliberately absent
 * here and must not appear as enforced entitlements until built.
 */

const PAST_DUE_GRACE_DAYS = 7;

export type SubscriptionSnapshot = {
  tier: PlanTier;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

export type Entitlements = {
  /** Effective plan after status policy - what the product should honor. */
  plan: PlanTier;
  /** null = unlimited. */
  likesPerDay: number | null;
  superLikesPerDay: number;
  /** Rewind / undo last swipe. */
  undo: boolean;
  /** "Say hello before you match" daily budget (FirstMessage flow). */
  firstMessagesPerDay: number;
};

/** Pure status policy - exported for tests and for callers that already hold the row. */
export function effectiveTier(sub: SubscriptionSnapshot | null, now = new Date()): PlanTier {
  if (!sub || sub.tier === "FREE") return "FREE";
  switch (sub.status) {
    case "ACTIVE":
    case "TRIALING":
      // cancelAtPeriodEnd stays entitled until Stripe actually ends it.
      return sub.tier;
    case "PAST_DUE": {
      if (!sub.currentPeriodEnd) return "FREE";
      const graceEnd = sub.currentPeriodEnd.getTime() + PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000;
      return now.getTime() <= graceEnd ? sub.tier : "FREE";
    }
    default:
      return "FREE";
  }
}

export function entitlementsForTier(tier: PlanTier): Entitlements {
  const limits = SWIPE_LIMITS[tier];
  return {
    plan: tier,
    likesPerDay: limits.likesPerDay === Infinity ? null : (limits.likesPerDay as number),
    superLikesPerDay: limits.superLikesPerDay,
    undo: limits.undo,
    firstMessagesPerDay: FIRST_MESSAGE_LIMITS[tier],
  };
}

export async function effectiveTierOf(userId: string, now = new Date()): Promise<PlanTier> {
  const sub = await db.subscription.findUnique({
    where: { userId },
    select: { tier: true, status: true, currentPeriodEnd: true, cancelAtPeriodEnd: true },
  });
  return effectiveTier(sub, now);
}

/** THE entitlements entry point - every premium gate goes through here. */
export async function getUserEntitlements(userId: string, now = new Date()): Promise<Entitlements> {
  return entitlementsForTier(await effectiveTierOf(userId, now));
}
