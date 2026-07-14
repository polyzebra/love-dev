import { apiError, guardRate, notFound, ok, requireSession, validationError } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { profileUpdateSchema } from "@/lib/validators/profile";
import { db } from "@/lib/db";
import { computeCompletion } from "@/lib/services/profile";

export async function GET() {
  const { user, response } = await requireSession();
  if (response) return response;

  const profile = await db.profile.findUnique({
    where: { userId: user.id },
    include: { interests: { include: { interest: true } } },
  });
  if (!profile) return notFound("Profile");

  return ok(profile);
}

export async function PATCH(req: Request) {
  const { user, response } = await requireSession();
  if (response) return response;

  const limited = await guardRate(`profile-write:${user.id}`, RATE_LIMITS.profileWrite);
  if (limited) return limited;

  // Presence-aware parse: profileUpdateSchema inherits field DEFAULTS
  // from the onboarding schema, so a naive partial parse would fabricate
  // values for absent keys (languages: [], prompts: [], ...) and a
  // bio-only PATCH would silently wipe unrelated fields. Only keys the
  // client actually sent may reach the update.
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return apiError(400, "invalid_json", "Request body must be valid JSON.");
  }
  const parsed = profileUpdateSchema.safeParse(json);
  if (!parsed.success) return validationError(parsed.error);
  const present = new Set(Object.keys(json as Record<string, unknown>));

  const { interests, prompts, ...allFields } = parsed.data;
  void interests; // interest edits go through the onboarding/profile service
  const fields = Object.fromEntries(Object.entries(allFields).filter(([key]) => present.has(key)));

  const updated = await db.profile.update({
    where: { userId: user.id },
    data: fields,
    include: { interests: true, user: { select: { photos: { select: { id: true } } } } },
  });

  // Prompts are a relation - replace the whole answered set when provided
  if (prompts && present.has("prompts")) {
    await db.$transaction([
      db.profilePrompt.deleteMany({ where: { profileId: updated.id } }),
      ...(prompts.length > 0
        ? [
            db.profilePrompt.createMany({
              data: prompts.map((p, i) => ({
                profileId: updated.id,
                promptKey: p.key,
                answer: p.answer,
                sortOrder: i,
              })),
            }),
          ]
        : []),
    ]);
  }

  const completionPct = computeCompletion({
    ...updated,
    interestCount: updated.interests.length,
    photoCount: updated.user.photos.length,
  });
  await db.profile.update({ where: { userId: user.id }, data: { completionPct } });

  return ok({ ...updated, completionPct });
}
