import { notFound, ok, requireSession } from "@/lib/api";
import { db } from "@/lib/db";
import { deletePhotoObjects } from "@/lib/services/photos";
import { resolveCasesForDeletedPhoto } from "@/lib/services/trust-safety";
import {
  invalidateBadgeOnGalleryChange,
  recordGalleryInvalidationSideEffects,
} from "@/lib/services/gallery-integrity";
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

  // L6.5: delete the row, promote a new cover if needed, AND invalidate the
  // verified badge - all in ONE transaction. Deleting any visible photo is a
  // material gallery change, so the blue badge drops immediately (before this
  // response) until reverification. `cover_changed` when the cover went.
  const reason = photo.isCover ? ("cover_changed" as const) : ("photo_deleted" as const);
  await db.$transaction(async (tx) => {
    await tx.photo.delete({ where: { id: photo.id } });
    if (photo.isCover) {
      const next = await tx.photo.findFirst({
        where: { userId: user.id },
        orderBy: { position: "asc" },
        select: { id: true },
      });
      if (next) {
        await tx.photo.update({ where: { id: next.id }, data: { isCover: true } });
      }
    }
    await invalidateBadgeOnGalleryChange(user.id, reason, { tx });
  });

  // Edge case: photo deleted mid-review - auto-resolve moderation cases
  // whose subject was exactly this photo (trust-safety.ts).
  await resolveCasesForDeletedPhoto(photo.id).catch(() => undefined);

  // Best-effort side effects after the badge-off commit (dormant grant + audit).
  await recordGalleryInvalidationSideEffects(user.id, reason);

  // The face layer must re-verify the current gallery before the badge can
  // rest on it again (dormant-safe; runs post-response).
  const { onProfilePhotosChanged, runProfilePhotoVerification } =
    await import("@/lib/services/face-verification");
  await onProfilePhotosChanged(user.id, reason);
  after(() => runProfilePhotoVerification(user.id));

  return ok({ deleted: true });
}
