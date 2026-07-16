import { notFound, ok, requirePermission } from "@/lib/api";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { sendSafetyNotice } from "@/lib/services/safety-notices";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/photos/[id]/approve - staff approval from the moderation
 * queue. Transactional: moderation APPROVED + status ACTIVE + an audit event
 * carrying the reviewer's actorId, all-or-nothing. Also mirrored to AdminLog.
 */
export async function POST(_req: Request, { params }: Params) {
  const { id } = await params;
  const { user, response } = await requirePermission("photos:moderate");
  if (response) return response;

  const photo = await db.photo.findUnique({
    where: { id },
    select: { id: true, userId: true, moderation: true, isCover: true },
  });
  if (!photo) return notFound("Photo");

  await db.$transaction([
    db.photo.update({
      where: { id: photo.id },
      data: {
        moderation: "APPROVED",
        status: "ACTIVE",
        moderatedById: user.id,
        moderatedAt: new Date(),
      },
    }),
    db.photoModerationEvent.create({
      data: {
        photoId: photo.id,
        actorId: user.id,
        action: "approved",
        reason: `approved by staff (was ${photo.moderation})`,
      },
    }),
  ]);

  await audit({
    actorId: user.id,
    action: "photo.approve",
    targetType: "photo",
    targetId: photo.id,
    metadata: { ownerId: photo.userId, previousModeration: photo.moderation },
  });
  // Tell the owner their photo cleared review (idempotent per photo).
  await sendSafetyNotice(photo.userId, "photo_approved", `photo:${photo.id}:staff-approved`, {
    photoId: photo.id,
  });

  // M2: a photo activation is a trust-affecting profile mutation - re-drive the
  // canonical Trust Engine exactly like any other photo change (no
  // moderation-specific badge logic). No-op while the face layer is dormant.
  const { onProfilePhotosChanged } = await import("@/lib/services/face-verification");
  await onProfilePhotosChanged(
    photo.userId,
    photo.isCover ? "cover_changed" : "photo_moderated",
  ).catch(() => undefined);

  return ok({ id: photo.id, moderation: "APPROVED", status: "ACTIVE" });
}
