import { requireSession } from "@/lib/api";
import { isPhotoVariant, mediaEtag } from "@/lib/services/photos";
import { authorizeMediaAccess, downloadPhotoVariant } from "@/lib/services/media";

/**
 * GET /api/media/[photoId]/[variant] - the canonical URL surface for
 * profile photo bytes. The "listing-images" bucket is private; this route
 * authorizes the CANONICAL principal (cookie or Bearer - requireSession,
 * Phase 0C) on every request, then streams the object server-side with
 * the service role (route authz is the boundary - see services/media.ts).
 * A leaked proxy URL grants nothing without a session.
 *
 * Access model (authorizeMediaAccess):
 *  - 401 without a session (photos are never anonymous)
 *  - the owner always sees their own photos (any status, e.g. under review)
 *  - staff (ADMIN/MODERATOR) see any photo - the /admin/photos moderation
 *    queue renders REJECTED thumbnails for review
 *  - everyone else: ACTIVE photos that are not moderation-REJECTED, and
 *    never across a blocked pair (either direction)
 *
 * Caching: the bytes behind a given photoId+variant only change when a
 * repair/reprocess rewrites the objects in place (which bumps
 * Photo.mediaVersion), so responses are `private, max-age=31536000,
 * immutable` with a synthetic `"{photoId}-{variant}-v{mediaVersion}"` ETag
 * answered with 304 on If-None-Match - after a reprocess the tag no longer
 * matches and clients refetch. `private` keeps shared caches/CDNs from
 * serving bytes across users while browsers cache aggressively; the 304
 * path still runs the full authorization first.
 */

type Params = { params: Promise<{ photoId: string; variant: string }> };

export async function GET(req: Request, { params }: Params) {
  const { photoId, variant } = await params;
  const { user, response } = await requireSession();
  if (response) return response;

  if (!isPhotoVariant(variant)) {
    return new Response("Not found", { status: 404 });
  }

  const access = await authorizeMediaAccess(photoId, user);
  if (!access.ok) {
    return new Response(access.status === 404 ? "Not found" : "Forbidden", {
      status: access.status,
    });
  }

  const etag = mediaEtag(photoId, variant, access.photo.mediaVersion);
  const cacheHeaders = {
    "Content-Type": "image/webp",
    "Cache-Control": "private, max-age=31536000, immutable",
    ETag: etag,
  } as const;

  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: cacheHeaders });
  }

  const data = await downloadPhotoVariant(access.photo, variant);
  if (!data) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(data.stream(), { headers: cacheHeaders });
}
