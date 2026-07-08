import { apiError, created, guardRate, requireSession } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { PHOTO_LIMITS } from "@/lib/constants";
import { db } from "@/lib/db";
import {
  makeBlurDataUrl,
  PhotoStorageNotConfiguredError,
  processProfilePhoto,
  uploadProfilePhoto,
} from "@/lib/services/photos";

const MAX_BYTES = PHOTO_LIMITS.maxSizeMb * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

/** POST /api/photos - multipart upload of a single profile photo. */
export async function POST(req: Request) {
  const { user, response } = await requireSession();
  if (response) return response;

  const limited = await guardRate(`photos:${user.id}`, RATE_LIMITS.api);
  if (limited) return limited;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return apiError(400, "invalid_body", "Request must be multipart/form-data with a `file` field.");
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return apiError(400, "missing_file", "Attach the image as a `file` field.");
  }
  if (!ACCEPTED_TYPES.has(file.type)) {
    return apiError(415, "unsupported_type", "Use a JPEG, PNG, WebP, or HEIC image.");
  }
  if (file.size > MAX_BYTES) {
    return apiError(413, "file_too_large", `Photos must be under ${PHOTO_LIMITS.maxSizeMb}MB.`);
  }

  const photoCount = await db.photo.count({ where: { userId: user.id } });
  if (photoCount >= PHOTO_LIMITS.max) {
    return apiError(409, "photo_limit", `You can have at most ${PHOTO_LIMITS.max} photos.`);
  }

  const input = Buffer.from(await file.arrayBuffer());

  let processed: Awaited<ReturnType<typeof processProfilePhoto>>;
  let blurDataUrl: string;
  try {
    [processed, blurDataUrl] = await Promise.all([
      processProfilePhoto(input),
      makeBlurDataUrl(input),
    ]);
  } catch {
    return apiError(422, "invalid_image", "We could not read that image. Try a different file.");
  }

  try {
    const uploaded = await uploadProfilePhoto(user.id, processed);

    const last = await db.photo.findFirst({
      where: { userId: user.id },
      orderBy: { position: "desc" },
      select: { position: true },
    });

    const photo = await db.photo.create({
      data: {
        userId: user.id,
        url: uploaded.cardUrl,
        thumbUrl: uploaded.thumbUrl,
        fullUrl: uploaded.fullUrl,
        blurDataUrl,
        width: processed.width,
        height: processed.height,
        position: (last?.position ?? -1) + 1,
      },
      select: {
        id: true,
        url: true,
        thumbUrl: true,
        fullUrl: true,
        blurDataUrl: true,
        width: true,
        height: true,
        position: true,
        moderation: true,
        createdAt: true,
      },
    });

    return created(photo);
  } catch (error) {
    if (error instanceof PhotoStorageNotConfiguredError) {
      return apiError(503, "storage_unavailable", "Photo storage not configured.");
    }
    return apiError(502, "upload_failed", "We could not store that photo. Please try again.");
  }
}
