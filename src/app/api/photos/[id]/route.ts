import { notFound, ok, requireSession } from "@/lib/api";
import { db } from "@/lib/db";
import { deletePhotoObjects } from "@/lib/services/photos";
import { resolveCasesForDeletedPhoto } from "@/lib/services/trust-safety";
import { after } from "next/server";

type Params = { params: Promise<{ id: string }> };

/** DELETE /api/photos/[id] - owner-only removal of a photo (storage + row). */
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const { user, response } = await requireSession();
  if (response) return response;

  // Scoped to the session user so nobody can delete someone else's photo.
  const photo = await db.photo.findFirst({
    where: { id, userId: user.id },
    select: { id: true, storagePath: true, isCover: true },
  });
  if (!photo) return notFound("Photo");

  // Best effort: a storage failure should not leave the row behind.
  // Demo rows without a storagePath have no bucket objects to remove.
  try {
    await deletePhotoObjects(photo.storagePath);
  } catch {
    // Storage not configured or transient error - row removal still proceeds.
  }

  await db.photo.delete({ where: { id: photo.id } });

  // Edge case: photo deleted mid-review - auto-resolve moderation cases
  // whose subject was exactly this photo (trust-safety.ts).
  await resolveCasesForDeletedPhoto(photo.id).catch(() => undefined);

  // If the cover was removed, promote the photo now first in line.
  if (photo.isCover) {
    const next = await db.photo.findFirst({
      where: { userId: user.id },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    if (next) {
      await db.photo.update({ where: { id: next.id }, data: { isCover: true } });
    }
  }

  // Deleting the cover promotes a new one - the face layer must re-verify
  // the NEW cover before the badge can rest on it.
  const { onProfilePhotosChanged, runProfilePhotoVerification } =
    await import("@/lib/services/face-verification");
  await onProfilePhotosChanged(user.id, photo.isCover ? "cover_changed" : "photo_deleted");
  after(() => runProfilePhotoVerification(user.id));

  return ok({ deleted: true });
}
