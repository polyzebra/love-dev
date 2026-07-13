export const APP_NAME = "Tirvea";
export const APP_TAGLINE = "Dating, designed with intention.";
export const SUPPORTED_COUNTRIES = [
  { code: "IE", label: "Ireland" },
  { code: "GB", label: "United Kingdom" },
] as const;

export const MIN_AGE = 18;
export const MAX_AGE = 99;

export const PHOTO_LIMITS = { min: 2, max: 10, maxSizeMb: 10 } as const;

export const BIO_MAX_LENGTH = 500;
export const MESSAGE_MAX_LENGTH = 2000;

/** Daily swipe budgets by plan; enforced server-side via entitlements.
 * HONESTY RULE: only capabilities that exist in the product belong here.
 * Boosts had a constant once (aspirational copy) - removed until a boost
 * mechanism actually ships. */
export const SWIPE_LIMITS = {
  FREE: { likesPerDay: 25, superLikesPerDay: 1, undo: false },
  PLUS: { likesPerDay: Infinity, superLikesPerDay: 5, undo: true },
  GOLD: { likesPerDay: Infinity, superLikesPerDay: 10, undo: true },
} as const;

/** "Message before match" first messages per day, by plan tier. */
export const FIRST_MESSAGE_LIMITS = {
  FREE: 3,
  PLUS: 10,
  GOLD: 25,
} as const;

export const FIRST_MESSAGE_MAX_LENGTH = 280;

/** A pending first message waits this long before it expires. */
export const FIRST_MESSAGE_TTL_DAYS = 14;

/**
 * The plan catalogue - THE single client-safe source for plan naming and
 * pricing (stripe.ts derives its price expectations from here). Exact
 * naming everywhere: "Tirvea Free" / "Tirvea Plus" / "Tirvea Gold" -
 * never a bare "Tirvea" plan chip.
 *
 * HONESTY RULE (same as entitlements.ts): every feature line below is a
 * capability that exists in the product today. Boosts, "see who liked
 * you", priority discovery and premium filters have no mechanism yet and
 * must not be sold. First messages exist on EVERY tier (3/10/25 a day),
 * so paid copy says "more", never "exclusive".
 */
export const PLANS = [
  {
    tier: "FREE",
    name: "Tirvea Free",
    priceMonthlyCents: 0,
    tagline: "Start meeting people",
    features: [
      "25 likes a day, each with real reasons you match",
      "1 Super Like a day to show real interest",
      "3 first messages a day - say hello before you match",
      "Photo verification so people know it's you",
      "Profile prompts that show the real you",
    ],
  },
  {
    tier: "PLUS",
    name: "Tirvea Plus",
    priceMonthlyCents: 1499,
    tagline: "Date with momentum",
    features: [
      "Like without a daily cap - never lose momentum",
      "Rewind - take back an accidental pass",
      "5 Super Likes a day to open with intent",
      "10 first messages a day - more chances to go first",
      "Everything in Tirvea Free",
    ],
  },
  {
    tier: "GOLD",
    name: "Tirvea Gold",
    priceMonthlyCents: 2999,
    tagline: "The full experience",
    features: [
      "Everything in Tirvea Plus",
      "Unlimited likes and rewind, included",
      "10 Super Likes a day - double the intent",
      "25 first messages a day - open every door yourself",
    ],
  },
] as const;

export type Plan = (typeof PLANS)[number];
export type PlanTierName = Plan["tier"];

/**
 * THE canonical subscription hierarchy: FREE < PLUS < GOLD, defined by
 * the order of PLANS above. Every upgrade surface (settings, pricing,
 * change-plan validation) derives from these two helpers - a user's
 * current plan can never appear as an upgrade option, and adding a tier
 * to PLANS automatically propagates everywhere.
 */
export function planRank(tier: PlanTierName): number {
  return PLANS.findIndex((p) => p.tier === tier);
}

/** Plans strictly ABOVE the given tier - the only valid upgrade targets. */
export function upgradePlansFor(tier: PlanTierName): Plan[] {
  return PLANS.filter((p) => planRank(p.tier) > planRank(tier));
}

/**
 * What a member on `tier` loses when their plan ends and the account
 * returns to Tirvea Free - DERIVED from the real entitlement tables
 * (SWIPE_LIMITS / FIRST_MESSAGE_LIMITS), so the list can never promise
 * or threaten anything the product doesn't actually enforce. Neutral
 * information, no fear tactics.
 */
export function downgradeLossesFor(tier: PlanTierName): string[] {
  if (tier === "FREE") return [];
  const paid = SWIPE_LIMITS[tier];
  const free = SWIPE_LIMITS.FREE;
  const losses: string[] = [];
  if (paid.likesPerDay === Infinity && free.likesPerDay !== Infinity) {
    losses.push(`Unlimited likes (Free has ${free.likesPerDay} a day)`);
  }
  if (paid.undo && !free.undo) {
    losses.push("Rewind - taking back an accidental pass");
  }
  if (paid.superLikesPerDay > free.superLikesPerDay) {
    losses.push(
      `${paid.superLikesPerDay} Super Likes a day (Free has ${free.superLikesPerDay})`,
    );
  }
  if (FIRST_MESSAGE_LIMITS[tier] > FIRST_MESSAGE_LIMITS.FREE) {
    losses.push(
      `${FIRST_MESSAGE_LIMITS[tier]} first messages a day (Free has ${FIRST_MESSAGE_LIMITS.FREE})`,
    );
  }
  return losses;
}

export const INTEREST_CATALOGUE: { category: string; items: string[] }[] = [
  {
    category: "Going out",
    items: ["Live music", "Pubs", "Comedy", "Theatre", "Festivals", "Foodie", "Coffee dates"],
  },
  {
    category: "Staying in",
    items: ["Cooking", "Baking", "Board games", "Gardening", "Reading", "Films", "Podcasts"],
  },
  {
    category: "Sports",
    items: ["GAA", "Rugby", "Football", "Running", "Gym", "Sea swimming", "Hiking", "Yoga", "Cycling", "Golf"],
  },
  {
    category: "Creativity",
    items: ["Photography", "Writing", "Painting", "Music", "Dancing", "Crafts"],
  },
  {
    category: "Values & lifestyle",
    items: ["Volunteering", "Sustainability", "Politics", "Spirituality", "Travel", "Languages", "Dogs", "Cats"],
  },
] as const;

export const LANGUAGES = [
  "English",
  "Irish",
  "Welsh",
  "Scottish Gaelic",
  "French",
  "Spanish",
  "Portuguese",
  "Polish",
  "Italian",
  "German",
  "Romanian",
  "Ukrainian",
  "Lithuanian",
  "Mandarin",
  "Hindi",
  "Urdu",
  "Arabic",
] as const;

export const ROUTES = {
  home: "/",
  pricing: "/pricing",
  safety: "/safety",
  login: "/login",
  register: "/register",
  onboarding: "/onboarding",
  discover: "/discover",
  matches: "/matches",
  chat: "/chat",
  profile: "/profile",
  settings: "/settings",
  admin: "/admin",
} as const;
