import { notFound, ok, requirePermission } from "@/lib/api";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";

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
    select: { id: true, userId: true, moderation: true },
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

  return ok({ id: photo.id, moderation: "APPROVED", status: "ACTIVE" });
}
