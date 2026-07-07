import { db } from "@/lib/db";
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

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export async function completeOnboarding(userId: string, input: OnboardingInput) {
  const { interests, prompts, ...fields } = input;

  return db.$transaction(async (tx) => {
    // Ensure the interest catalogue rows exist, then connect them
    const interestRows = await Promise.all(
      interests.map((label) =>
        tx.interest.upsert({
          where: { slug: slugify(label) },
          create: { slug: slugify(label), label, category: "Custom" },
          update: {},
        }),
      ),
    );

    const photoCount = await tx.photo.count({ where: { userId } });
    const completionPct = computeCompletion({
      ...fields,
      interestCount: interests.length,
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
