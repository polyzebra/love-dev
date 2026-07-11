import { apiError, created, guardRate, requireSession } from "@/lib/api";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { PHOTO_LIMITS } from "@/lib/constants";
import { db } from "@/lib/db";
import { moderatePhoto } from "@/lib/services/moderation";
import { assertUploadAllowed } from "@/lib/services/trust-safety";
import {
  deletePhotoObjects,
  makeBlurDataUrl,
  photoProxyPath,
  PhotoProcessingError,
  PhotoStorageNotConfiguredError,
  PhotoUploadIntegrityError,
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

  // Trust-safety enforcement: uploads are blocked while the account is
  // restricted, photo-review-required, or carrying an active
  // UPLOAD_BLOCKED violation (graduated ladder, trust-safety.ts).
  const gate = await assertUploadAllowed(user.id);
  if (!gate.ok) return apiError(403, gate.code, gate.message);

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

  // The original bytes live ONLY in this buffer: they are re-encoded into
  // WebP variants below and never persisted anywhere (we keep just the
  // original's mimeType/sizeBytes as metadata on the row). If processing or
  // validation fails, NOTHING has been written - the user still has their
  // original and simply retries with another file.
  const input = Buffer.from(await file.arrayBuffer());
  console.info(
    `[photos:upload] user=${user.id} received bytes=${input.length} declaredType=${file.type} name=${JSON.stringify(file.name)}`,
  );

  let processed: Awaited<ReturnType<typeof processProfilePhoto>>;
  let blurDataUrl: string;
  try {
    [processed, blurDataUrl] = await Promise.all([
      processProfilePhoto(input),
      makeBlurDataUrl(input),
    ]);
  } catch (error) {
    if (error instanceof PhotoProcessingError) {
      // A generated variant failed decode-back validation. Abort before any
      // write and log the full diagnostics for the audit trail.
      console.error(
        `[photos:upload] user=${user.id} image_processing_failed:`,
        JSON.stringify(error.diagnostics),
      );
      return apiError(
        422,
        "image_processing_failed",
        "We could not process that photo safely, so nothing was saved. " +
          "Your original stays with you - we never store it. Please try a different photo.",
      );
    }
    return apiError(422, "invalid_image", "We could not read that image. Try a different file.");
  }

  let uploaded: Awaited<ReturnType<typeof uploadProfilePhoto>>;
  try {
    uploaded = await uploadProfilePhoto(user.id, processed);
  } catch (error) {
    if (error instanceof PhotoStorageNotConfiguredError) {
      return apiError(503, "storage_unavailable", "Photo storage not configured.");
    }
    if (error instanceof PhotoUploadIntegrityError) {
      // Storage returned different bytes than we sent (platform-level
      // corruption). Everything was removed; nothing is recorded.
      console.error(
        `[photos:upload] user=${user.id} upload_integrity_failed:`,
        JSON.stringify(error.diagnostics),
      );
      return apiError(
        502,
        "upload_integrity_failed",
        "Storing that photo did not complete safely, so nothing was saved. Please try again.",
      );
    }
    return apiError(502, "upload_failed", "We could not store that photo. Please try again.");
  }

  try {
    const last = await db.photo.findFirst({
      where: { userId: user.id },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const position = (last?.position ?? -1) + 1;

    const photo = await db.photo.create({
      data: {
        // Row id == storage id, so /api/media/{photoId}/{variant} and
        // users/{uid}/photos/{photoId}/ address the same photo.
        id: uploaded.photoId,
        userId: user.id,
        // Stored URLs are relative proxy paths - the private bucket is only
        // reachable through GET /api/media/[photoId]/[variant].
        url: photoProxyPath(uploaded.photoId, "card"),
        thumbUrl: photoProxyPath(uploaded.photoId, "thumb"),
        galleryUrl: photoProxyPath(uploaded.photoId, "gallery"),
        fullUrl: photoProxyPath(uploaded.photoId, "full"),
        storagePath: uploaded.storagePath,
        blurDataUrl,
        blurhash: processed.blurhash,
        dominantColor: processed.dominantColor,
        mimeType: file.type,
        sizeBytes: file.size,
        width: processed.width,
        height: processed.height,
        position,
        // The very first photo is automatically the profile cover.
        isCover: position === 0,
        // ACTIVE for now: the moderation phase lands next and will own the
        // PROCESSING -> ACTIVE/REJECTED transition.
        status: "ACTIVE",
      },
      select: {
        id: true,
        url: true,
        thumbUrl: true,
        galleryUrl: true,
        fullUrl: true,
        blurDataUrl: true,
        blurhash: true,
        dominantColor: true,
        width: true,
        height: true,
        position: true,
        isCover: true,
        status: true,
        moderation: true,
        createdAt: true,
      },
    });

    // Automated moderation: picks a provider by env (external when
    // MODERATION_API_URL/KEY are set, otherwise the honest null provider),
    // applies the verdict to Photo.status / Photo.moderation transactionally
    // and records a PhotoModerationEvent. Never throws for provider failures.
    await moderatePhoto(photo.id);

    return created(photo);
  } catch {
    // The DB row never landed - remove the orphaned storage objects.
    await deletePhotoObjects(uploaded.storagePath).catch(() => undefined);
    return apiError(502, "upload_failed", "We could not save that photo. Please try again.");
  }
}
