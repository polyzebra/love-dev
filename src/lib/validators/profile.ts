import { z } from "zod";
import { BIO_MAX_LENGTH, MAX_AGE, MIN_AGE } from "@/lib/constants";

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
}, `You must be ${MIN_AGE} or older to use Amora`);

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
    interests: z.array(z.string().max(48)).min(3, "Pick at least 3 interests").max(12),
    smoking: lifestyleEnum.optional().default("PREFER_NOT_TO_SAY"),
    drinking: lifestyleEnum.optional().default("PREFER_NOT_TO_SAY"),
    exercise: exerciseEnum.optional().nullable(),
    children: childrenEnum.optional().nullable(),
    pets: petsEnum.optional().nullable(),
    religion: z.string().trim().max(60).optional().nullable(),
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
