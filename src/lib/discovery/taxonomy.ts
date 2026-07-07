import type { RelationshipGoal } from "@/generated/prisma/enums";

/**
 * THE canonical discovery taxonomy - the single source of truth for
 * onboarding, Explore, Discover scoring, match reasons and chat
 * openers. No surface may hardcode its own category list.
 *
 * 20 categories, quality over quantity. Everything outside this list
 * lives on as a secondary profile interest/trait, never as a main
 * Explore category.
 */

export type TaxonomyGroup =
  | "right-now"
  | "relationship"
  | "lifestyle"
  | "interests"
  | "community";

export const GROUP_LABELS: Record<TaxonomyGroup, string> = {
  "right-now": "Right now",
  relationship: "Relationship",
  lifestyle: "Lifestyle",
  interests: "Interests",
  community: "Community",
};

export type OnboardingStep = "intentions" | "date-style" | "interests-community";

/** Where a category's signal lives on the Profile. */
export type ProfileFieldMapping =
  | "availabilityTags" // Right-now moods - Profile.availabilityTags
  | "relationshipGoal" // Single-select intent - Profile.relationshipGoal
  | "interests" // Interest catalogue rows - ProfileInterest by slug
  | "communityTags"; // Community belonging - Profile.communityTags

export type TaxonomyCategory = {
  id: string;
  slug: string;
  group: TaxonomyGroup;
  label: string;
  shortLabel: string;
  description: string;
  emotionalMeaning: string;
  /** Lucide icon name - rendered via the shared ICONS map, never emoji. */
  icon: string;
  colorToken: "rose" | "amber" | "emerald" | "sky" | "violet" | "gold";
  onboardingStep: OnboardingStep;
  onboardingVisible: boolean;
  exploreVisible: boolean;
  profileFieldMapping: ProfileFieldMapping;
  /** For relationshipGoal mappings: the enum value this category represents. */
  goalValue?: RelationshipGoal;
  /** For interests mappings: Interest catalogue slugs that count as this category. */
  interestSlugs?: string[];
  /** Points this category contributes when shared (scoring engine). */
  scoringWeight: number;
  chatPromptTemplates: string[];
  matchReasonTemplates: string[];
};

export const TAXONOMY: TaxonomyCategory[] = [
  // ------------------------------------------------------- RIGHT NOW
  {
    id: "free-tonight",
    slug: "free-tonight",
    group: "right-now",
    label: "Free tonight",
    shortLabel: "Tonight",
    description: "Open to meeting this evening.",
    emotionalMeaning: "Spontaneity over scheduling",
    icon: "Sparkles",
    colorToken: "rose",
    onboardingStep: "date-style",
    onboardingVisible: true,
    exploreVisible: true,
    profileFieldMapping: "availabilityTags",
    scoringWeight: 5,
    chatPromptTemplates: [
      "Ask what they feel like doing tonight.",
      "Suggest something easy this evening.",
    ],
    matchReasonTemplates: [
      "You're both free tonight.",
      "Tonight could actually happen.",
    ],
  },
  {
    id: "coffee-now",
    slug: "coffee-now",
    group: "right-now",
    label: "Coffee now",
    shortLabel: "Coffee now",
    description: "Up for a spontaneous coffee.",
    emotionalMeaning: "Low-stakes, right away",
    icon: "CupSoda",
    colorToken: "amber",
    onboardingStep: "date-style",
    onboardingVisible: true,
    exploreVisible: true,
    profileFieldMapping: "availabilityTags",
    scoringWeight: 5,
    chatPromptTemplates: [
      "Ask if they fancy a coffee nearby.",
      "Ask about their go-to coffee spot.",
    ],
    matchReasonTemplates: [
      "You're both up for a spontaneous coffee.",
      "Coffee could happen today.",
    ],
  },
  {
    id: "walk-together",
    slug: "walk-together",
    group: "right-now",
    label: "Walk together",
    shortLabel: "Walk",
    description: "A walk and a real conversation.",
    emotionalMeaning: "Side by side beats face to face",
    icon: "Footprints",
    colorToken: "emerald",
    onboardingStep: "date-style",
    onboardingVisible: true,
    exploreVisible: true,
    profileFieldMapping: "availabilityTags",
    scoringWeight: 4,
    chatPromptTemplates: [
      "Ask about their favourite walking route.",
      "Suggest a walk somewhere green.",
    ],
    matchReasonTemplates: [
      "You'd both rather walk and talk.",
      "A walk together is an easy first step.",
    ],
  },
  {
    id: "weekend-plans",
    slug: "weekend-plans",
    group: "right-now",
    label: "Weekend plans",
    shortLabel: "Weekend",
    description: "Looking for something to do this weekend.",
    emotionalMeaning: "The weekend is better shared",
    icon: "CalendarDays",
    colorToken: "sky",
    onboardingStep: "date-style",
    onboardingVisible: true,
    exploreVisible: true,
    profileFieldMapping: "availabilityTags",
    scoringWeight: 4,
    chatPromptTemplates: [
      "Ask what their ideal Saturday looks like.",
      "Ask what they're up to this weekend.",
    ],
    matchReasonTemplates: [
      "You're both looking for weekend plans.",
      "This weekend is wide open for both of you.",
    ],
  },
  // ---------------------------------------------------- RELATIONSHIP
  {
    id: "long-term",
    slug: "long-term",
    group: "relationship",
    label: "Long-term relationship",
    shortLabel: "Long-term",
    description: "Here for something that lasts.",
    emotionalMeaning: "Building, not browsing",
    icon: "Heart",
    colorToken: "rose",
    onboardingStep: "intentions",
    onboardingVisible: true,
    exploreVisible: true,
    profileFieldMapping: "relationshipGoal",
    goalValue: "LONG_TERM",
    scoringWeight: 8,
    chatPromptTemplates: [
      "Ask what makes dating feel intentional to them.",
      "Ask what a good relationship looks like to them.",
    ],
    matchReasonTemplates: [
      "You both want something long-term.",
      "You're both here for something real.",
    ],
  },
  {
    id: "marriage-minded",
    slug: "marriage-minded",
    group: "relationship",
    label: "Marriage-minded",
    shortLabel: "Marriage",
    description: "Dating with marriage in mind.",
    emotionalMeaning: "Clear about the destination",
    icon: "Gem",
    colorToken: "gold",
    onboardingStep: "intentions",
    onboardingVisible: true,
    exploreVisible: true,
    profileFieldMapping: "relationshipGoal",
    goalValue: "MARRIAGE_MINDED",
    scoringWeight: 8,
    chatPromptTemplates: [
      "Ask what partnership means to them.",
      "Ask what they're building towards.",
    ],
    matchReasonTemplates: [
      "You're both dating with marriage in mind.",
      "You both know where this should lead.",
    ],
  },
  {
    id: "casual-dating",
    slug: "casual-dating",
    group: "relationship",
    label: "Casual dating",
    shortLabel: "Casual",
    description: "Good company, no pressure.",
    emotionalMeaning: "Enjoying the present",
    icon: "Zap",
    colorToken: "violet",
    onboardingStep: "intentions",
    onboardingVisible: true,
    exploreVisible: true,
    profileFieldMapping: "relationshipGoal",
    goalValue: "SHORT_TERM",
    scoringWeight: 8,
    chatPromptTemplates: [
      "Ask what fun looks like for them lately.",
      "Suggest something spontaneous.",
    ],
    matchReasonTemplates: [
      "You're both keeping it light.",
      "No pressure suits you both.",
    ],
  },
  {
    id: "new-friends",
    slug: "new-friends",
    group: "relationship",
    label: "New friends",
    shortLabel: "Friends",
    description: "Real friendship first.",
    emotionalMeaning: "Connection without expectation",
    icon: "Users",
    colorToken: "sky",
    onboardingStep: "intentions",
    onboardingVisible: true,
    exploreVisible: true,
    profileFieldMapping: "relationshipGoal",
    goalValue: "FRIENDSHIP",
    scoringWeight: 8,
    chatPromptTemplates: [
      "Ask what they like doing with friends.",
      "Ask what a good weekend with mates looks like.",
    ],
    matchReasonTemplates: [
      "You're both here for real friendship.",
      "Friendship first works for both of you.",
    ],
  },
  {
    id: "open-to-possibilities",
    slug: "open-to-possibilities",
    group: "relationship",
    label: "Open to possibilities",
    shortLabel: "Open",
    description: "Seeing where it goes.",
    emotionalMeaning: "Curious, not committed to a script",
    icon: "Compass",
    colorToken: "emerald",
    onboardingStep: "intentions",
    onboardingVisible: true,
    exploreVisible: true,
    profileFieldMapping: "relationshipGoal",
    goalValue: "OPEN_TO_EITHER",
    scoringWeight: 8,
    chatPromptTemplates: [
      "Ask what caught their eye about your profile.",
      "Ask what they're hoping to find here.",
    ],
    matchReasonTemplates: [
      "You're both open to possibilities.",
      "Neither of you needs a label yet.",
    ],
  },
  // ------------------------------------------------------- LIFESTYLE
  {
    id: "coffee-dates",
    slug: "coffee-dates",
    group: "lifestyle",
    label: "Coffee dates",
    shortLabel: "Coffee",
    description: "Easy, low-pressure first dates.",
    emotionalMeaning: "A simple first meeting",
    icon: "Coffee",
    colorToken: "amber",
    onboardingStep: "date-style",
    onboardingVisible: true,
    exploreVisible: true,
    profileFieldMapping: "interests",
    interestSlugs: ["coffee-dates"],
    scoringWeight: 4,
    chatPromptTemplates: [
      "Ask about their favourite cafe.",
      "Suggest coffee this week.",
    ],
    matchReasonTemplates: [
      "You both like coffee dates.",
      "Coffee could be a natural first plan.",
    ],
  },
  {
    id: "foodies",
    slug: "foodies",
    group: "lifestyle",
    label: "Foodies",
    shortLabel: "Food",
    description: "Good food is the plan.",
    emotionalMeaning: "Taste as a shared adventure",
    icon: "UtensilsCrossed",
    colorToken: "rose",
    onboardingStep: "date-style",
    onboardingVisible: true,
    exploreVisible: true,
    profileFieldMapping: "interests",
    interestSlugs: ["foodie", "cooking", "baking"],
    scoringWeight: 4,
    chatPromptTemplates: [
      "Ask about the best meal they've had lately.",
      "Ask for the one restaurant they always recommend.",
    ],
    matchReasonTemplates: [
      "You're both foodies.",
      "Dinner plans basically write themselves.",
    ],
  },
  {
    id: "music-lovers",
    slug: "music-lovers",
    group: "lifestyle",
    label: "Music lovers",
    shortLabel: "Music",
    description: "Gigs, playlists, late-night albums.",
    emotionalMeaning: "A soundtrack in common",
    icon: "Music",
    colorToken: "violet",
    onboardingStep: "date-style",
    onboardingVisible: true,
    exploreVisible: true,
    profileFieldMapping: "interests",
    interestSlugs: ["live-music", "music"],
    scoringWeight: 4,
    chatPromptTemplates: [
      "Ask what song they have on repeat.",
      "Ask about the best gig they've been to.",
    ],
    matchReasonTemplates: [
      "You both love music.",
      "A gig together sounds about right.",
    ],
  },
  {
    id: "nature-lovers",
    slug: "nature-lovers",
    group: "lifestyle",
    label: "Nature lovers",
    shortLabel: "Nature",
    description: "Happiest outdoors.",
    emotionalMeaning: "Clear head, open air",
    icon: "TreePine",
    colorToken: "emerald",
    onboardingStep: "date-style",
    onboardingVisible: true,
    exploreVisible: true,
    profileFieldMapping: "interests",
    interestSlugs: ["hiking", "sea-swimming", "gardening"],
    scoringWeight: 4,
    chatPromptTemplates: [
      "Ask where they go to clear their head.",
      "Ask about their favourite hike.",
    ],
    matchReasonTemplates: [
      "You both love being in nature.",
      "You'd both pick a trail over a screen.",
    ],
  },
  {
    id: "fitness",
    slug: "fitness",
    group: "lifestyle",
    label: "Fitness",
    shortLabel: "Fitness",
    description: "Movement is part of the week.",
    emotionalMeaning: "Energy that shows up daily",
    icon: "Dumbbell",
    colorToken: "sky",
    onboardingStep: "date-style",
    onboardingVisible: true,
    exploreVisible: true,
    profileFieldMapping: "interests",
    interestSlugs: ["gym", "running", "yoga", "cycling"],
    scoringWeight: 4,
    chatPromptTemplates: [
      "Ask how they like to train.",
      "Ask about their favourite way to move.",
    ],
    matchReasonTemplates: [
      "You both make time for fitness.",
      "An active first date is on the table.",
    ],
  },
  // ------------------------------------------------------- INTERESTS
  {
    id: "gaming",
    slug: "gaming",
    group: "interests",
    label: "Gaming",
    shortLabel: "Gaming",
    description: "Co-op nights and favourite worlds.",
    emotionalMeaning: "Play as a love language",
    icon: "Gamepad2",
    colorToken: "violet",
    onboardingStep: "interests-community",
    onboardingVisible: true,
    exploreVisible: true,
    profileFieldMapping: "interests",
    interestSlugs: ["gaming"],
    scoringWeight: 3,
    chatPromptTemplates: [
      "Ask what they're playing right now.",
      "Ask about the game they always come back to.",
    ],
    matchReasonTemplates: [
      "You both game.",
      "Co-op night is a real first-date option.",
    ],
  },
  {
    id: "movies-tv",
    slug: "movies-tv",
    group: "interests",
    label: "Movies & TV",
    shortLabel: "Movies",
    description: "Cinema trips and series worth finishing.",
    emotionalMeaning: "Stories to share",
    icon: "Clapperboard",
    colorToken: "amber",
    onboardingStep: "interests-community",
    onboardingVisible: true,
    exploreVisible: true,
    profileFieldMapping: "interests",
    interestSlugs: ["films", "tv-series", "theatre"],
    scoringWeight: 3,
    chatPromptTemplates: [
      "Ask what they're watching at the moment.",
      "Ask for the film they can quote start to finish.",
    ],
    matchReasonTemplates: [
      "You both love film and TV.",
      "A cinema trip is an easy yes for you two.",
    ],
  },
  {
    id: "creativity",
    slug: "creativity",
    group: "interests",
    label: "Creativity",
    shortLabel: "Creative",
    description: "Making things - art, words, music, craft.",
    emotionalMeaning: "A maker's way of seeing",
    icon: "Palette",
    colorToken: "rose",
    onboardingStep: "interests-community",
    onboardingVisible: true,
    exploreVisible: true,
    profileFieldMapping: "interests",
    interestSlugs: ["painting", "photography", "writing", "crafts", "dancing"],
    scoringWeight: 3,
    chatPromptTemplates: [
      "Ask what they're making at the moment.",
      "Ask what they'd create with a free month.",
    ],
    matchReasonTemplates: [
      "You're both creative.",
      "You both make things - compare notes.",
    ],
  },
  // ------------------------------------------------------- COMMUNITY
  {
    id: "irish",
    slug: "irish",
    group: "community",
    label: "Irish",
    shortLabel: "Irish",
    description: "Rooted in Ireland.",
    emotionalMeaning: "Home in common",
    icon: "Clover",
    colorToken: "emerald",
    onboardingStep: "interests-community",
    onboardingVisible: true,
    exploreVisible: true,
    profileFieldMapping: "communityTags",
    scoringWeight: 2,
    chatPromptTemplates: [
      "Ask where in Ireland feels most like home.",
      "Ask for their favourite spot back home.",
    ],
    matchReasonTemplates: [
      "You're both Irish.",
      "Home means the same place to you both.",
    ],
  },
  {
    id: "uk",
    slug: "uk",
    group: "community",
    label: "UK",
    shortLabel: "UK",
    description: "Based in or from the UK.",
    emotionalMeaning: "Shared ground to start from",
    icon: "Crown",
    colorToken: "sky",
    onboardingStep: "interests-community",
    onboardingVisible: true,
    exploreVisible: true,
    profileFieldMapping: "communityTags",
    scoringWeight: 2,
    chatPromptTemplates: [
      "Ask which city they know best.",
      "Ask for the most underrated place in the UK.",
    ],
    matchReasonTemplates: [
      "You're both from the UK.",
      "You know the same streets.",
    ],
  },
  {
    id: "international",
    slug: "international",
    group: "community",
    label: "International",
    shortLabel: "Global",
    description: "A story that crosses borders.",
    emotionalMeaning: "The world in one conversation",
    icon: "Globe",
    colorToken: "gold",
    onboardingStep: "interests-community",
    onboardingVisible: true,
    exploreVisible: true,
    profileFieldMapping: "communityTags",
    scoringWeight: 2,
    chatPromptTemplates: [
      "Ask where their story started.",
      "Ask which place changed them most.",
    ],
    matchReasonTemplates: [
      "You both carry more than one home.",
      "Two passports, one conversation.",
    ],
  },
];

// ---------------------------------------------------------- helpers

export const byId = new Map(TAXONOMY.map((c) => [c.id, c]));
export const bySlug = new Map(TAXONOMY.map((c) => [c.slug, c]));

export const categoriesForGroup = (group: TaxonomyGroup) =>
  TAXONOMY.filter((c) => c.group === group);

export const categoriesForOnboardingStep = (step: OnboardingStep) =>
  TAXONOMY.filter((c) => c.onboardingStep === step && c.onboardingVisible);

export const exploreCategories = () => TAXONOMY.filter((c) => c.exploreVisible);

export const goalCategory = (goal: RelationshipGoal | null | undefined) =>
  goal ? TAXONOMY.find((c) => c.goalValue === goal) : undefined;

/** Categories a profile belongs to, given its structured fields. */
export function categoriesForProfile(p: {
  relationshipGoal: RelationshipGoal | null;
  availabilityTags: string[];
  communityTags: string[];
  interestSlugs: string[];
}): TaxonomyCategory[] {
  const slugs = new Set(p.interestSlugs);
  return TAXONOMY.filter((c) => {
    switch (c.profileFieldMapping) {
      case "relationshipGoal":
        return c.goalValue != null && c.goalValue === p.relationshipGoal;
      case "availabilityTags":
        return p.availabilityTags.includes(c.id);
      case "communityTags":
        return p.communityTags.includes(c.id);
      case "interests":
        return (c.interestSlugs ?? []).some((s) => slugs.has(s));
    }
  });
}

/** Deterministic template pick - stable per pair, no Math.random. */
export const pickTemplate = (templates: string[], seed: string) =>
  templates.length
    ? templates[Math.abs([...seed].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)) % templates.length]
    : "";

/** Canonical human phrasing of relationship intent - the only goal-line map. */
export const GOAL_LINES: Record<RelationshipGoal, string> = {
  LONG_TERM: "Looking for something real",
  MARRIAGE_MINDED: "Dating with marriage in mind",
  SHORT_TERM: "Keeping it light for now",
  OPEN_TO_EITHER: "Open to where it goes",
  FRIENDSHIP: "Here for real friendship",
  FIGURING_OUT: "Figuring it out",
};
