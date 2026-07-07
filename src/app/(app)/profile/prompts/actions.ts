"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import { PROFILE_PROMPTS } from "@/config/prompts";
import { profilePromptsSchema } from "@/lib/validators/profile";

export type SavePromptsState = { error: string | null };

/**
 * Replace the user's prompt answers with the submitted set.
 * Order of PROFILE_PROMPTS becomes sortOrder, so the profile and the
 * explore viewer render answers in a stable, curated order.
 */
export async function saveProfilePrompts(
  _prev: SavePromptsState,
  formData: FormData,
): Promise<SavePromptsState> {
  const user = await requireUser();
  const profile = await db.profile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  if (!profile) redirect("/onboarding");

  const answered = PROFILE_PROMPTS.map((p) => ({
    key: p.key,
    answer: String(formData.get(`prompt:${p.key}`) ?? "").trim(),
  })).filter((p) => p.answer.length > 0);

  const parsed = profilePromptsSchema.safeParse(answered);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check your answers and try again." };
  }

  await db.$transaction([
    db.profilePrompt.deleteMany({ where: { profileId: profile.id } }),
    ...(parsed.data.length > 0
      ? [
          db.profilePrompt.createMany({
            data: parsed.data.map((p, i) => ({
              profileId: profile.id,
              promptKey: p.key,
              answer: p.answer,
              sortOrder: i,
            })),
          }),
        ]
      : []),
  ]);

  revalidatePath("/profile");
  redirect("/profile");
}
