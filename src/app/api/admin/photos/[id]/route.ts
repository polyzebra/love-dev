import { notFound, ok, requirePermission } from "@/lib/api";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { deletePhotoObjects } from "@/lib/services/photos";

type Params = { params: Promise<{ id: string }> };

/**
 * DELETE /api/admin/photos/[id] - permanent staff removal: storage objects
 * (via deletePhotoObjects) + row delete. PhotoModerationEvents cascade with
 * the row, so the DURABLE record of this action is the AdminLog entry, which
 * captures the actor, owner, storage path and prior state. If the deleted
 * photo was the cover, the owner's next photo is promoted (same behaviour as
 * owner-initiated deletion).
 */
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const { user, response } = await requirePermission("photos:moderate");
  if (response) return response;

  const photo = await db.photo.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      storagePath: true,
      isCover: true,
      moderation: true,
      status: true,
    },
  });
  if (!photo) return notFound("Photo");

  // Best effort: a storage failure must not leave the row (and thus the
  // proxy URL) behind. Rows without a storagePath have no bucket objects.
  try {
    await deletePhotoObjects(photo.storagePath);
  } catch {
    // Storage not configured or transient error - row removal still proceeds.
  }

  await db.photo.delete({ where: { id: photo.id } });

  // Promote the owner's next photo if the cover was removed.
  if (photo.isCover) {
    const next = await db.photo.findFirst({
      where: { userId: photo.userId },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    if (next) {
      await db.photo.update({ where: { id: next.id }, data: { isCover: true } });
    }
  }

  await audit({
    actorId: user.id,
    action: "photo.delete",
    targetType: "photo",
    targetId: photo.id,
    metadata: {
      ownerId: photo.userId,
      storagePath: photo.storagePath,
      moderation: photo.moderation,
      status: photo.status,
      wasCover: photo.isCover,
    },
  });

  return ok({ deleted: true });
}
