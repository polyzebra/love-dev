import { apiError, requireSession } from "@/lib/api";
import { appealAttachmentsEnabled } from "@/lib/services/appeals";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/appeals/[id]/attachments - appeal evidence uploads.
 *
 * DESIGNED, NOT ENABLED (see appealAttachmentsEnabled in appeals.ts for
 * the full design: 1-3 images through the photo validation pipeline into
 * the private bucket, staff-only proxied access, AppealEvent audit).
 * Until the flag ships this returns an honest 501 - the endpoint never
 * pretends to accept files it would drop.
 */
export async function POST(_req: Request, { params }: Params) {
  await params;
  const { response } = await requireSession({ allowRestricted: true });
  if (response) return response;

  if (!appealAttachmentsEnabled()) {
    return apiError(
      501,
      "not_implemented",
      "Appeal attachments are not available yet. Please include details in your appeal text.",
    );
  }
  // Flag is on but the upload pipeline for appeals has not shipped - still
  // an honest 501 rather than a silent drop.
  return apiError(
    501,
    "not_implemented",
    "Appeal attachments are not available yet. Please include details in your appeal text.",
  );
}
