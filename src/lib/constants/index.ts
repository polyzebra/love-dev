export const APP_NAME = "Amora";
export const APP_TAGLINE = "Dating, designed with intention.";
export const SUPPORTED_COUNTRIES = [
  { code: "IE", label: "Ireland" },
  { code: "GB", label: "United Kingdom" },
] as const;

export const MIN_AGE = 18;
export const MAX_AGE = 99;

export const PHOTO_LIMITS = { min: 2, max: 9, maxSizeMb: 10 } as const;

export const BIO_MAX_LENGTH = 500;
export const MESSAGE_MAX_LENGTH = 2000;

/** Free-tier daily budgets; enforced server-side. */
export const SWIPE_LIMITS = {
  FREE: { likesPerDay: 25, superLikesPerDay: 1, undo: false, boostsPerMonth: 0 },
  PLUS: { likesPerDay: Infinity, superLikesPerDay: 5, undo: true, boostsPerMonth: 1 },
  PREMIUM: { likesPerDay: Infinity, superLikesPerDay: 10, undo: true, boostsPerMonth: 4 },
} as const;

export const PLANS = [
  {
    tier: "FREE",
    name: "Free",
    priceMonthlyCents: 0,
    tagline: "Start meeting people",
    features: ["25 likes a day", "1 Super Like a day", "Match & chat freely", "Photo verification"],
  },
  {
    tier: "PLUS",
    name: "Plus",
    priceMonthlyCents: 1499,
    tagline: "Date with momentum",
    features: [
      "Unlimited likes",
      "5 Super Likes a day",
      "Undo accidental passes",
      "1 Boost a month",
      "See who likes you",
    ],
  },
  {
    tier: "PREMIUM",
    name: "Premium",
    priceMonthlyCents: 2999,
    tagline: "The full experience",
    features: [
      "Everything in Plus",
      "10 Super Likes a day",
      "4 Boosts a month",
      "Priority in Discover",
      "Message before matching",
      "Advanced filters",
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
