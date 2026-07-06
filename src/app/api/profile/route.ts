import { notFound, ok, parseBody, requireSession } from "@/lib/api";
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

  const { data, response: invalid } = await parseBody(req, profileUpdateSchema);
  if (invalid) return invalid;

  const { interests, ...fields } = data;
  void interests; // interest edits go through the onboarding/profile service

  const updated = await db.profile.update({
    where: { userId: user.id },
    data: fields,
    include: { interests: true, user: { select: { photos: { select: { id: true } } } } },
  });

  const completionPct = computeCompletion({
    ...updated,
    interestCount: updated.interests.length,
    photoCount: updated.user.photos.length,
  });
  await db.profile.update({ where: { userId: user.id }, data: { completionPct } });

  return ok({ ...updated, completionPct });
}
