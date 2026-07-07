import { z } from "zod";
import { BIO_MAX_LENGTH, MAX_AGE, MIN_AGE } from "@/lib/constants";
import { PROFILE_PROMPTS, type PromptKey } from "@/config/prompts";

const PROMPT_KEYS = PROFILE_PROMPTS.map((p) => p.key) as [PromptKey, ...PromptKey[]];
export const promptKeyEnum = z.enum(PROMPT_KEYS);

export const PROMPT_ANSWER_MAX_LENGTH = 280;

export const profilePromptsSchema = z
  .array(
    z.object({
      key: promptKeyEnum,
      answer: z.string().trim().min(1).max(PROMPT_ANSWER_MAX_LENGTH),
    }),
  )
  .max(4, "Answer at most 4 prompts")
  .refine(
    (list) => new Set(list.map((p) => p.key)).size === list.length,
    "Each prompt can only be answered once",
  );

export const genderEnum = z.enum(["WOMAN", "MAN", "NON_BINARY", "OTHER"]);
export const relationshipGoalEnum = z.enum([
  "LONG_TERM",
  "SHORT_TERM",
  "OPEN_TO_EITHER",
  "FRIENDSHIP",
  "FIGURING_OUT",
]);
export const lifestyleEnum = z.enum(["NEVER", "RARELY", "SOCIALLY", "OFTEN", "PREFER_NOT_TO_SAY"]);
export const exerciseEnum = z.enum(["NEVER", "SOMETIMES", "REGULARLY", "DAILY"]);
export const educationEnum = z.enum([
  "SECONDARY",
  "UNDERGRADUATE",
  "POSTGRADUATE",
  "DOCTORATE",
  "TRADE_SCHOOL",
  "OTHER",
]);
export const childrenEnum = z.enum([
  "HAVE_AND_WANT_MORE",
  "HAVE_AND_DONT_WANT_MORE",
  "DONT_HAVE_WANT",
  "DONT_HAVE_DONT_WANT",
  "NOT_SURE",
]);
export const petsEnum = z.enum(["DOG", "CAT", "BOTH", "OTHER_PETS", "NONE", "ALLERGIC"]);

const adultBirthDate = z.coerce.date().refine((d) => {
  const age = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
  return age >= MIN_AGE && age <= 120;
}, `You must be ${MIN_AGE} or older to use Virelsy`);

export const onboardingSchema = z
  .object({
    displayName: z.string().trim().min(2).max(30),
    birthDate: adultBirthDate,
    gender: genderEnum,
    interestedIn: z.array(genderEnum).min(1, "Choose at least one"),
    relationshipGoal: relationshipGoalEnum,
    bio: z.string().trim().max(BIO_MAX_LENGTH).optional().default(""),
    city: z.string().trim().min(1, "Choose your city").max(80),
    country: z.enum(["IE", "GB"]),
    heightCm: z.coerce.number().int().min(120).max(230).optional().nullable(),
    languages: z.array(z.string().max(40)).max(8).default([]),
    occupation: z.string().trim().max(80).optional().nullable(),
    education: educationEnum.optional().nullable(),
    availabilityTags: z.array(z.string().max(40)).max(5).optional().default([]),
  personalityTags: z.array(z.string().max(40)).max(5).optional().default([]),
  communityTags: z.array(z.string().max(40)).max(6).optional().default([]),
  interests: z.array(z.string().max(48)).min(3, "Pick at least 3 interests").max(12),
    smoking: lifestyleEnum.optional().default("PREFER_NOT_TO_SAY"),
    drinking: lifestyleEnum.optional().default("PREFER_NOT_TO_SAY"),
    exercise: exerciseEnum.optional().nullable(),
    children: childrenEnum.optional().nullable(),
    pets: petsEnum.optional().nullable(),
    religion: z.string().trim().max(60).optional().nullable(),
    prompts: profilePromptsSchema.optional().default([]),
  })
  .strict();

export const profileUpdateSchema = onboardingSchema.partial();

export const discoveryPreferencesSchema = z
  .object({
    interestedIn: z.array(genderEnum).min(1),
    minAge: z.coerce.number().int().min(MIN_AGE).max(MAX_AGE),
    maxAge: z.coerce.number().int().min(MIN_AGE).max(MAX_AGE),
    maxDistanceKm: z.coerce.number().int().min(1).max(500),
    isVisible: z.boolean().optional(),
  })
  .refine((v) => v.minAge <= v.maxAge, {
    message: "Minimum age must be below maximum age",
    path: ["minAge"],
  });

export type OnboardingInput = z.infer<typeof onboardingSchema>;
