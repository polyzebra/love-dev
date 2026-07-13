import { z } from "zod";
import { apiError, ok, parseBody, requireSession } from "@/lib/api";
import { PHOTO_LIMITS } from "@/lib/constants";
import { db } from "@/lib/db";

const reorderSchema = z.object({
  order: z
    .array(z.string().min(1))
    .min(1)
    .max(PHOTO_LIMITS.max)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "Photo ids must be unique.",
    }),
});

/**
 * PATCH /api/photos/reorder - owner-only full reorder of profile photos.
 * Body: { order: string[] } listing EVERY photo id in the desired order.
 * Index 0 becomes the cover; positions follow array order.
 */
export async function PATCH(req: Request) {
  const { user, response } = await requireSession();
  if (response) return response;

  const { data, response: bodyError } = await parseBody(req, reorderSchema);
  if (bodyError) return bodyError;

  const photos = await db.photo.findMany({
    where: { userId: user.id },
    select: { id: true },
  });
  const owned = new Set(photos.map((p) => p.id));

  // Every id must belong to the session user, and the list must cover all of
  // the user's photos - a partial reorder would leave duplicate positions.
  if (data.order.length !== owned.size || !data.order.every((id) => owned.has(id))) {
    return apiError(400, "invalid_order", "Provide every photo id you own, exactly once.");
  }

  await db.$transaction(
    data.order.map((id, index) =>
      db.photo.update({
        where: { id },
        data: { position: index, isCover: index === 0 },
      }),
    ),
  );

  return ok({ reordered: true, order: data.order });
}
