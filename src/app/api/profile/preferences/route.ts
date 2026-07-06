import { ok, parseBody, requireSession } from "@/lib/api";
import { discoveryPreferencesSchema } from "@/lib/validators/profile";
import { db } from "@/lib/db";

export async function PATCH(req: Request) {
  const { user, response } = await requireSession();
  if (response) return response;

  const { data, response: invalid } = await parseBody(req, discoveryPreferencesSchema);
  if (invalid) return invalid;

  const updated = await db.profile.update({
    where: { userId: user.id },
    data,
    select: {
      interestedIn: true,
      minAge: true,
      maxAge: true,
      maxDistanceKm: true,
      isVisible: true,
    },
  });

  return ok(updated);
}
