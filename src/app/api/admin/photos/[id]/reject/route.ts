import { z } from "zod";
import { notFound, ok, parseBody, requirePermission } from "@/lib/api";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { sendSafetyNotice } from "@/lib/services/safety-notices";

type Params = { params: Promise<{ id: string }> };

const rejectSchema = z.object({
  reason: z.string().trim().min(3, "Give a reason the owner (and audit trail) can understand."),
});

/**
 * POST /api/admin/photos/[id]/reject - staff rejection with a REQUIRED
 * reason. Transactional: moderation REJECTED + status REJECTED + an audit
 * event with the reviewer's actorId. The media proxy (canViewPhoto) already
 * blocks REJECTED photos for everyone but the owner and staff, so the photo
 * is never public from the moment this commits. Mirrored to AdminLog.
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const { user, response } = await requirePermission("photos:moderate");
  if (response) return response;

  const { data, response: bodyError } = await parseBody(req, rejectSchema);
  if (bodyError) return bodyError;

  const photo = await db.photo.findUnique({
    where: { id },
    select: { id: true, userId: true, moderation: true, isCover: true },
  });
  if (!photo) return notFound("Photo");

  await db.$transaction([
    db.photo.update({
      where: { id: photo.id },
      data: {
        moderation: "REJECTED",
        status: "REJECTED",
        moderatedById: user.id,
        moderatedAt: new Date(),
      },
    }),
    db.photoModerationEvent.create({
      data: {
        photoId: photo.id,
        actorId: user.id,
        action: "rejected",
        reason: data.reason,
      },
    }),
  ]);

  await audit({
    actorId: user.id,
    action: "photo.reject",
    targetType: "photo",
    targetId: photo.id,
    metadata: { ownerId: photo.userId, reason: data.reason },
  });
  // Tell the owner (calm generic copy - the staff reason stays internal).
  await sendSafetyNotice(photo.userId, "photo_removed", `photo:${photo.id}:staff-rejected`, {
    photoId: photo.id,
  });

  // M2: a photo deactivation is a trust-affecting profile mutation - re-drive
  // the canonical Trust Engine (a rejected cover -> the cover is no longer
  // confirmable -> the worker withholds/clears). No-op while dormant.
  const { onProfilePhotosChanged } = await import("@/lib/services/face-verification");
  await onProfilePhotosChanged(
    photo.userId,
    photo.isCover ? "cover_changed" : "photo_moderated",
  ).catch(() => undefined);

  return ok({ id: photo.id, moderation: "REJECTED", status: "REJECTED" });
}
