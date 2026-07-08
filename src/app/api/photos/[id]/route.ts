import { notFound, ok, requireSession } from "@/lib/api";
import { db } from "@/lib/db";
import { deletePhotoObjects } from "@/lib/services/photos";

type Params = { params: Promise<{ id: string }> };

/** DELETE /api/photos/[id] - owner-only removal of a photo (storage + row). */
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const { user, response } = await requireSession();
  if (response) return response;

  // Scoped to the session user so nobody can delete someone else's photo.
  const photo = await db.photo.findFirst({
    where: { id, userId: user.id },
    select: { id: true, url: true, thumbUrl: true, fullUrl: true },
  });
  if (!photo) return notFound("Photo");

  // Best effort: a storage failure should not leave the row behind.
  try {
    await deletePhotoObjects([photo.url, photo.thumbUrl, photo.fullUrl]);
  } catch {
    // Storage not configured or transient error - row removal still proceeds.
  }

  await db.photo.delete({ where: { id: photo.id } });
  return ok({ deleted: true });
}
