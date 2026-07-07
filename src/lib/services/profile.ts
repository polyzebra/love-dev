import { db } from "@/lib/db";
import { GROUP_LABELS, TAXONOMY } from "@/lib/discovery/taxonomy";
import type { OnboardingInput } from "@/lib/validators/profile";

/** Weighted profile completion - drives the progress ring in the UI. */
export function computeCompletion(profile: {
  bio?: string | null;
  heightCm?: number | null;
  occupation?: string | null;
  education?: unknown | null;
  languages?: string[];
  exercise?: unknown | null;
  children?: unknown | null;
  pets?: unknown | null;
  religion?: string | null;
  interestCount: number;
  photoCount: number;
}): number {
  let score = 30; // base for required onboarding fields
  if (profile.photoCount >= 2) score += 15;
  if (profile.photoCount >= 4) score += 5;
  if ((profile.bio?.length ?? 0) >= 40) score += 15;
  if (profile.interestCount >= 3) score += 10;
  if (profile.heightCm) score += 4;
  if (profile.occupation) score += 5;
  if (profile.education) score += 4;
  if (profile.languages?.length) score += 3;
  if (profile.exercise) score += 3;
  if (profile.children) score += 2;
  if (profile.pets) score += 2;
  if (profile.religion) score += 2;
  return Math.min(100, score);
}

/** The taxonomy category an interest slug belongs to (canonical labels). */
function taxonomyCategoryForSlug(slug: string) {
  return TAXONOMY.find((c) => c.interestSlugs?.includes(slug));
}

export async function completeOnboarding(userId: string, input: OnboardingInput) {
  const { interests, prompts, ...fields } = input;
  // Interests arrive as canonical taxonomy slugs (validated upstream)
  const interestSlugs = [...new Set(interests)];

  return db.$transaction(async (tx) => {
    // Ensure the interest catalogue rows exist, then connect them
    const interestRows = await Promise.all(
      interestSlugs.map((slug) => {
        const category = taxonomyCategoryForSlug(slug);
        return tx.interest.upsert({
          where: { slug },
          create: {
            slug,
            label: category?.label ?? slug,
            category: category ? GROUP_LABELS[category.group] : "Custom",
          },
          update: {},
        });
      }),
    );

    const photoCount = await tx.photo.count({ where: { userId } });
    const completionPct = computeCompletion({
      ...fields,
      interestCount: interestSlugs.length,
      photoCount,
    });

    const profile = await tx.profile.upsert({
      where: { userId },
      create: {
        userId,
        ...fields,
        completionPct,
        interests: {
          create: interestRows.map((row) => ({ interestId: row.id })),
        },
      },
      update: {
        ...fields,
        completionPct,
        interests: {
          deleteMany: {},
          create: interestRows.map((row) => ({ interestId: row.id })),
        },
      },
    });

    // Prompt answers: replace wholesale, sortOrder preserves selection order
    await tx.profilePrompt.deleteMany({ where: { profileId: profile.id } });
    if (prompts.length > 0) {
      await tx.profilePrompt.createMany({
        data: prompts.map((p, index) => ({
          profileId: profile.id,
          promptKey: p.key,
          answer: p.answer,
          sortOrder: index,
        })),
      });
    }

    await tx.user.update({
      where: { id: userId },
      data: { onboardingDone: true, name: fields.displayName },
    });

    return profile;
  });
}
