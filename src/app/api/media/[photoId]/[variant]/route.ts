import { requireSession } from "@/lib/api";
import { db } from "@/lib/db";
import { isStaff } from "@/lib/rbac";
import { canViewPhoto, isPhotoVariant, mediaEtag, PHOTOS_BUCKET } from "@/lib/services/photos";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * GET /api/media/[photoId]/[variant] - the ONLY URL surface for profile
 * photo bytes. The "listing-images" bucket is private; this route fetches
 * the object server-side with the caller's Supabase JWT and streams it back.
 *
 * Access model:
 *  - 401 without a session (photos are never anonymous)
 *  - the owner always sees their own photos (any status, e.g. under review)
 *  - staff (ADMIN/MODERATOR) see any photo - required so the /admin/photos
 *    moderation queue can render REJECTED thumbnails for review
 *  - everyone else only sees ACTIVE photos that are not moderation-REJECTED
 *
 * Caching: the bytes behind a given photoId+variant only change when a
 * repair/reprocess rewrites the objects in place (which bumps
 * Photo.mediaVersion), so responses are `private, max-age=31536000,
 * immutable` with a synthetic `"{photoId}-{variant}-v{mediaVersion}"` ETag
 * answered with 304 on If-None-Match - after a reprocess the tag no longer
 * matches and clients refetch the new bytes. `private` keeps shared
 * caches/CDNs from serving bytes across users while browsers cache
 * aggressively.
 */

type Params = { params: Promise<{ photoId: string; variant: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { photoId, variant } = await params;
  const { user, response } = await requireSession();
  if (response) return response;

  if (!isPhotoVariant(variant)) {
    return new Response("Not found", { status: 404 });
  }

  const photo = await db.photo.findUnique({
    where: { id: photoId },
    select: { userId: true, status: true, moderation: true, storagePath: true, mediaVersion: true },
  });
  if (!photo || !photo.storagePath) {
    return new Response("Not found", { status: 404 });
  }

  // Staff bypass exists ONLY for the admin moderation queue; members are
  // always subject to the pure canViewPhoto rule.
  if (!canViewPhoto(photo, user.id) && !isStaff(user.role)) {
    return new Response("Forbidden", { status: 403 });
  }

  const etag = mediaEtag(photoId, variant, photo.mediaVersion);
  const cacheHeaders = {
    "Content-Type": "image/webp",
    "Cache-Control": "private, max-age=31536000, immutable",
    ETag: etag,
  } as const;

  // Content per photoId+variant+mediaVersion is immutable, so a matching
  // ETag short-circuits before we touch storage (authorization already ran
  // above). A reprocess bumps mediaVersion and busts this.
  if (_req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: cacheHeaders });
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase.storage
    .from(PHOTOS_BUCKET)
    .download(`${photo.storagePath}/${variant}.webp`);
  if (error || !data) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(data.stream(), { headers: cacheHeaders });
}
