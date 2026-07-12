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

/** Free-tier daily budgets; enforced server-side. NOTE: boostsPerMonth is
 * aspirational pricing copy - no boost mechanism exists in the product
 * yet, so it is NOT exposed through entitlements (honesty rule). */
export const SWIPE_LIMITS = {
  FREE: { likesPerDay: 25, superLikesPerDay: 1, undo: false, boostsPerMonth: 0 },
  PLUS: { likesPerDay: Infinity, superLikesPerDay: 5, undo: true, boostsPerMonth: 1 },
  GOLD: { likesPerDay: Infinity, superLikesPerDay: 10, undo: true, boostsPerMonth: 4 },
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

export const PLANS = [
  {
    tier: "FREE",
    name: "Tirvea",
    priceMonthlyCents: 0,
    tagline: "Start meeting people",
    features: [
      "25 daily picks, each with real reasons you match",
      "Conversation starters built from what you share",
      "First-date ideas once the chat gets going",
      "1 Super Like a day to show real interest",
      "Photo verification so people know it's you",
    ],
  },
  {
    tier: "PLUS",
    name: "Tirvea Plus",
    priceMonthlyCents: 1499,
    tagline: "Date with momentum",
    features: [
      "Like without a daily cap - never lose momentum",
      "See who is already waiting for you - reply first",
      "Take back an accidental pass",
      "5 Super Likes a day to open with intent",
      "1 Boost a month to be seen first",
    ],
  },
  {
    tier: "GOLD",
    name: "Tirvea Gold",
    priceMonthlyCents: 2999,
    tagline: "The full experience",
    features: [
      "Everything in Plus",
      "Priority discovery - shown to more of the right people",
      "Say hello before you match",
      "Sharper filters to find exactly your kind of person",
      "10 Super Likes a day",
      "4 Boosts a month for the moments that matter",
    ],
  },
] as const;

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
