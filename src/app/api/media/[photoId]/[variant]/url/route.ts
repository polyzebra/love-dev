import { NextResponse } from "next/server";
import { apiError, requireSession } from "@/lib/api";
import { isPhotoVariant } from "@/lib/services/photos";
import { authorizeMediaAccess, createSignedMediaUrl } from "@/lib/services/media";

/**
 * GET /api/media/[photoId]/[variant]/url - mint a SHORT-LIVED signed
 * storage URL for one authorized photo variant (Phase 0I hybrid: the
 * proxy stays canonical; this exists for image pipelines that want
 * direct-to-storage fetches, e.g. native shells). Exact same
 * authorization as the byte proxy; the signature dies after
 * SIGNED_MEDIA_TTL_SECONDS, so a leaked URL is worthless within about a
 * minute and can never become permanent access. The response itself is
 * no-store - the URL is a credential.
 */

type Params = { params: Promise<{ photoId: string; variant: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { photoId, variant } = await params;
  const { user, response } = await requireSession();
  if (response) return response;

  if (!isPhotoVariant(variant)) {
    return apiError(404, "not_found", "Media not found.");
  }

  const access = await authorizeMediaAccess(photoId, user);
  if (!access.ok) {
    return access.status === 404
      ? apiError(404, "not_found", "Media not found.")
      : apiError(403, "forbidden", "You cannot access this media.");
  }

  const signed = await createSignedMediaUrl(access.photo, variant);
  if (!signed) {
    return apiError(503, "media_unavailable", "Signed media URLs are not available right now.");
  }

  return NextResponse.json({ data: signed }, { headers: { "Cache-Control": "no-store" } });
}
