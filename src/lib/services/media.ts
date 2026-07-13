import { db } from "@/lib/db";
import { isStaff } from "@/lib/rbac";
import type { Role } from "@/generated/prisma/enums";
import { storageClient, storageServiceClientOrNull } from "@/lib/storage";
import { canViewPhoto, PHOTOS_BUCKET, type PhotoVariant } from "@/lib/services/photos";

/**
 * Read-side media access (Phase 0I). DECISION: a controlled hybrid.
 *
 *  - The authenticated PROXY (/api/media/[photoId]/[variant]) stays the
 *    canonical URL surface: authorization runs on EVERY request against
 *    the canonical principal (cookie or Bearer - requireSession), so a
 *    leaked proxy URL grants nothing without a session.
 *  - Short-lived SIGNED URLs (/api/media/[photoId]/[variant]/url) exist
 *    for clients whose image pipelines want direct-to-storage fetches
 *    (native shells, prefetchers). Same authorization, then a
 *    SIGNED_MEDIA_TTL_SECONDS-second storage signature - a leaked signed
 *    URL dies in about a minute and the endpoint response is no-store.
 *  - No long-lived or public URLs exist anywhere; the bucket stays
 *    private and only server-side code can mint access.
 *
 * Storage reads use the SERVICE ROLE when configured: the route-level
 * authorization above is the access boundary, and tying the byte fetch
 * to the caller's cookie JWT would break Bearer clients (Phase 0C) for
 * no security gain. Falls back to the cookie-bound client in keyless
 * dev environments.
 */

export type MediaViewer = { id: string; role: Role };

export type MediaPhoto = {
  id: string;
  userId: string;
  status: string;
  moderation: string;
  storagePath: string;
  mediaVersion: number;
};

export type MediaAccessResult = { ok: true; photo: MediaPhoto } | { ok: false; status: 403 | 404 };

/**
 * The ONE authorization rule for photo bytes, shared by the proxy and
 * the signed-URL endpoint:
 *  - owner: always (any status - they see their own under-review photos)
 *  - staff: always (the admin moderation queue renders REJECTED photos)
 *  - everyone else: ACTIVE, not moderation-REJECTED, and NO block in
 *    either direction between viewer and owner (Phase 0I hardening -
 *    blocked pairs no longer share media bytes even by direct URL)
 */
export async function authorizeMediaAccess(
  photoId: string,
  viewer: MediaViewer,
): Promise<MediaAccessResult> {
  const photo = await db.photo.findUnique({
    where: { id: photoId },
    select: {
      id: true,
      userId: true,
      status: true,
      moderation: true,
      storagePath: true,
      mediaVersion: true,
    },
  });
  if (!photo || !photo.storagePath) return { ok: false, status: 404 };
  const row = photo as MediaPhoto & { storagePath: string };

  if (photo.userId === viewer.id || isStaff(viewer.role)) return { ok: true, photo: row };
  if (!canViewPhoto(photo, viewer.id)) return { ok: false, status: 403 };

  const block = await db.block.findFirst({
    where: {
      OR: [
        { blockerId: viewer.id, blockedId: photo.userId },
        { blockerId: photo.userId, blockedId: viewer.id },
      ],
    },
    select: { id: true },
  });
  if (block) return { ok: false, status: 403 };

  return { ok: true, photo: row };
}

// ---------------------------------------------------------------------------
// Storage reads (through the lib/storage adapter - Phase 0K)
// ---------------------------------------------------------------------------

/**
 * Fetch one variant's bytes. Service-role when configured (works for
 * cookie AND Bearer principals); cookie-bound client otherwise.
 */
export async function downloadPhotoVariant(
  photo: Pick<MediaPhoto, "storagePath">,
  variant: PhotoVariant,
): Promise<Blob | null> {
  const client = await storageClient();
  const { data, error } = await client.storage
    .from(PHOTOS_BUCKET)
    .download(`${photo.storagePath}/${variant}.webp`);
  if (error || !data) return null;
  return data;
}

/** How long a signed media URL lives. Short by design (leak containment). */
export const SIGNED_MEDIA_TTL_SECONDS = 60;

export type SignedMediaUrl = { url: string; expiresAt: string; ttlSeconds: number };

/**
 * Mint a short-lived signed URL for one variant (AFTER authorization).
 * Returns null when the service role is not configured - callers answer
 * 503 rather than pretending.
 */
export async function createSignedMediaUrl(
  photo: Pick<MediaPhoto, "storagePath">,
  variant: PhotoVariant,
  ttlSeconds: number = SIGNED_MEDIA_TTL_SECONDS,
): Promise<SignedMediaUrl | null> {
  const client = storageServiceClientOrNull();
  if (!client) return null;
  const { data, error } = await client.storage
    .from(PHOTOS_BUCKET)
    .createSignedUrl(`${photo.storagePath}/${variant}.webp`, ttlSeconds);
  if (error || !data?.signedUrl) return null;
  return {
    url: data.signedUrl,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    ttlSeconds,
  };
}
