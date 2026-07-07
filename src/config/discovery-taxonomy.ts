/**
 * Canonical discovery taxonomy - the ONE source of truth consumed by
 * onboarding, profile editing, Explore, matching and the seed. Never
 * duplicate these lists elsewhere.
 *
 * matchingRule mirrors ExploreCategory.matcher and is applied by
 * lib/services/explore.ts membershipWhere().
 */

export type TaxonomyGroup =
  | "TODAY"
  | "GOALS"
  | "LIFESTYLE"
  | "INTERESTS"
  | "PERSONALITY"
  | "COMMUNITIES";

export type MatchingRule =
  | { kind: "interests"; values: string[] }
  | { kind: "goal"; values: string[] }
  | { kind: "country"; values: string[] }
  | { kind: "availability"; values: string[] }
  | { kind: "personality"; values: string[] }
  | { kind: "community"; values: string[] }
  | { kind: "recentlyActive"; hours?: number }
  | { kind: "preference" };

export type TaxonomyItem = {
  id: string; // slug
  group: TaxonomyGroup;
  label: string;
  description: string;
  icon: string; // iconKey for the 3D visual
  /** Which onboarding step collects it */
  onboardingField: "interests" | "relationshipGoal" | "country" | "availabilityTags" | "personalityTags" | "communityTags";
  /** Where it lives on Profile */
  profileField: "interests" | "relationshipGoal" | "country" | "availabilityTags" | "personalityTags" | "communityTags";
  matchingRule: MatchingRule;
  emptyStateCopy: string;
  gradientFrom: string;
  gradientTo: string;
};

const t = (
  id: string, group: TaxonomyGroup, label: string, description: string, icon: string,
  field: TaxonomyItem["onboardingField"], matchingRule: MatchingRule, emptyStateCopy: string,
  gradientFrom: string, gradientTo: string,
): TaxonomyItem => ({ id, group, label, description, icon, onboardingField: field, profileField: field, matchingRule, emptyStateCopy, gradientFrom, gradientTo });

export const DISCOVERY_TAXONOMY: TaxonomyItem[] = [
  // TODAY - availability
  t("free-tonight", "TODAY", "Free tonight", "Open to plans this evening.", "tonight", "availabilityTags", { kind: "availability", values: ["free-tonight"] }, "No one free tonight yet - be the first.", "#818cf8", "#1e1b4b"),
  t("weekend-plans", "TODAY", "Weekend plans", "Looking ahead to Saturday.", "weekend", "availabilityTags", { kind: "availability", values: ["weekend-plans"] }, "No weekend planners yet - add it to your profile.", "#fb7185", "#9f1239"),
  t("coffee-now", "TODAY", "Coffee now", "Spontaneous flat whites.", "coffee-now", "availabilityTags", { kind: "availability", values: ["coffee-now"] }, "No spontaneous coffees yet - be the first.", "#d9a066", "#78350f"),
  t("walk-together", "TODAY", "Walk together", "Fresh air and conversation.", "walk", "availabilityTags", { kind: "availability", values: ["walk-together"] }, "No walkers yet - start the trend.", "#4ade80", "#166534"),
  t("dinner-tonight", "TODAY", "Dinner tonight", "Table for two, tonight.", "dinner", "availabilityTags", { kind: "availability", values: ["dinner-tonight"] }, "No dinner dates yet - be the first.", "#fbbf24", "#92400e"),
  // GOALS
  t("long-term-partner", "GOALS", "Long-term partner", "Building something that lasts.", "long-term", "relationshipGoal", { kind: "goal", values: ["LONG_TERM"] }, "Update your relationship goal to appear here.", "#fb7185", "#881337"),
  t("serious-relationship", "GOALS", "Serious relationship", "Done with games. Ready for real.", "ring", "relationshipGoal", { kind: "goal", values: ["LONG_TERM", "OPEN_TO_EITHER"] }, "Update your relationship goal to appear here.", "#f9a8d4", "#9d174d"),
  t("marriage-minded", "GOALS", "Marriage-minded", "Thinking in decades.", "marriage", "relationshipGoal", { kind: "goal", values: ["LONG_TERM"] }, "Update your relationship goal to appear here.", "#e7c9a1", "#854d0e"),
  t("new-friends", "GOALS", "New friends", "Connection first.", "friends", "relationshipGoal", { kind: "goal", values: ["FRIENDSHIP"] }, "Update your relationship goal to appear here.", "#fde047", "#a16207"),
  t("casual-dating", "GOALS", "Casual dating", "Good company, no pressure.", "casual", "relationshipGoal", { kind: "goal", values: ["SHORT_TERM", "OPEN_TO_EITHER"] }, "Update your relationship goal to appear here.", "#c084fc", "#6b21a8"),
  // LIFESTYLE - interests relation
  t("coffee-dates", "LIFESTYLE", "Coffee dates", "Best first date fits in a cup.", "coffee", "interests", { kind: "interests", values: ["coffee-dates"] }, "Add Coffee dates to your interests to appear here.", "#d9a066", "#7a4a21"),
  t("foodies", "LIFESTYLE", "Foodies", "Menus read like novels.", "food", "interests", { kind: "interests", values: ["foodie", "cooking", "baking"] }, "Add food interests to appear here.", "#fb7185", "#9f1239"),
  t("music-lovers", "LIFESTYLE", "Music lovers", "Gig tickets over gym selfies.", "music", "interests", { kind: "interests", values: ["live-music", "music"] }, "Add music to your interests to appear here.", "#a78bfa", "#4c1d95"),
  t("nature-lovers", "LIFESTYLE", "Nature lovers", "Happiest outdoors.", "nature", "interests", { kind: "interests", values: ["hiking", "gardening", "sea-swimming"] }, "Add outdoor interests to appear here.", "#4ade80", "#14532d"),
  t("travellers", "LIFESTYLE", "Travellers", "Passport within reach.", "travel", "interests", { kind: "interests", values: ["travel"] }, "Add Travel to your interests to appear here.", "#38bdf8", "#0c4a6e"),
  t("pet-lovers", "LIFESTYLE", "Pet lovers", "Camera roll is 80% animals.", "pets", "interests", { kind: "interests", values: ["dogs", "cats"] }, "Add pets to your interests to appear here.", "#fbbf24", "#92400e"),
  t("gym-lovers", "LIFESTYLE", "Gym lovers", "Endorphins first.", "gym", "interests", { kind: "interests", values: ["gym", "running", "cycling"] }, "Add fitness interests to appear here.", "#f87171", "#7f1d1d"),
  // INTERESTS
  t("gamers", "INTERESTS", "Gamers", "Co-op hearts.", "gaming", "interests", { kind: "interests", values: ["board-games", "gaming"] }, "Add gaming to your interests to appear here.", "#818cf8", "#312e81"),
  t("creatives", "INTERESTS", "Creatives", "Makers and dreamers.", "creative", "interests", { kind: "interests", values: ["painting", "writing", "crafts", "dancing"] }, "Add creative interests to appear here.", "#f472b6", "#831843"),
  t("photography", "INTERESTS", "Photography", "Sees the world in golden hour.", "photo", "interests", { kind: "interests", values: ["photography"] }, "Add Photography to appear here.", "#94a3b8", "#1e293b"),
  t("reading", "INTERESTS", "Reading", "Judged kindly by bookshelf.", "reading", "interests", { kind: "interests", values: ["reading"] }, "Add Reading to appear here.", "#e7c9a1", "#78350f"),
  t("movies", "INTERESTS", "Movies", "Front row of best stories.", "movies", "interests", { kind: "interests", values: ["films"] }, "Add Films to appear here.", "#fb923c", "#7c2d12"),
  t("cars", "INTERESTS", "Cars", "Drives count as dates.", "cars", "interests", { kind: "interests", values: ["cars"] }, "Add Cars to appear here.", "#22d3ee", "#164e63"),
  t("tech", "INTERESTS", "Tech", "Builds things, fixes them better.", "tech", "interests", { kind: "interests", values: ["tech"] }, "Add Tech to appear here.", "#34d399", "#064e3b"),
  // PERSONALITY
  t("introverts", "PERSONALITY", "Introverts", "Deep talks over small talk.", "introvert", "personalityTags", { kind: "personality", values: ["introvert"] }, "Add your vibe in onboarding to appear here.", "#94a3b8", "#334155"),
  t("extroverts", "PERSONALITY", "Extroverts", "Rooms get brighter.", "extrovert", "personalityTags", { kind: "personality", values: ["extrovert"] }, "Add your vibe in onboarding to appear here.", "#fbbf24", "#b45309"),
  t("adventurers", "PERSONALITY", "Adventurers", "Says yes first.", "adventure", "personalityTags", { kind: "personality", values: ["adventurer"] }, "Add your vibe in onboarding to appear here.", "#34d399", "#065f46"),
  t("early-birds", "PERSONALITY", "Early birds", "Sunrise swims, first coffees.", "early-bird", "personalityTags", { kind: "personality", values: ["early-bird"] }, "Add your vibe in onboarding to appear here.", "#fde047", "#ca8a04"),
  t("night-owls", "PERSONALITY", "Night owls", "Best talks after midnight.", "night-owl", "personalityTags", { kind: "personality", values: ["night-owl"] }, "Add your vibe in onboarding to appear here.", "#818cf8", "#312e81"),
  // COMMUNITIES
  t("irish-singles", "COMMUNITIES", "Irish singles", "From Dublin to Dingle.", "map-ie", "country", { kind: "country", values: ["IE"] }, "Set Ireland as your country to appear here.", "#4ade80", "#14532d"),
  t("uk-singles", "COMMUNITIES", "UK singles", "London to the Highlands.", "map-uk", "country", { kind: "country", values: ["GB"] }, "Set the UK as your country to appear here.", "#60a5fa", "#1e3a8a"),
  t("expats", "COMMUNITIES", "Expats", "New city, open heart.", "expat", "communityTags", { kind: "community", values: ["expat"] }, "Mark yourself as an expat to appear here.", "#c084fc", "#581c87"),
  t("students", "COMMUNITIES", "Students", "Lectures by day.", "student", "communityTags", { kind: "community", values: ["student"] }, "Mark yourself as a student to appear here.", "#38bdf8", "#075985"),
  t("parents", "COMMUNITIES", "Parents", "Kids first - romance counts.", "parent", "communityTags", { kind: "community", values: ["parent"] }, "Mark yourself as a parent to appear here.", "#f9a8d4", "#9d174d"),
  t("dog-lovers", "COMMUNITIES", "Dog lovers", "Non-negotiable.", "dog-lover", "communityTags", { kind: "community", values: ["dog-lover"] }, "Add Dogs to your profile to appear here.", "#fbbf24", "#78350f"),
];

/** Chips shown in onboarding, per collected field. */
export const AVAILABILITY_OPTIONS = DISCOVERY_TAXONOMY.filter((i) => i.onboardingField === "availabilityTags");
export const PERSONALITY_OPTIONS = DISCOVERY_TAXONOMY.filter((i) => i.onboardingField === "personalityTags");
export const COMMUNITY_OPTIONS = DISCOVERY_TAXONOMY.filter((i) => i.onboardingField === "communityTags");
