import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Profile photo pipeline built around one canonical 4:5 portrait ratio.
 *
 * Every upload is normalized into three WebP variants:
 *  - thumb: 320x320 square (avatars, tiny previews)
 *  - card:  1200x1500 (4:5) - the canonical variant stored in Photo.url
 *  - full:  1800x2250 (4:5) - detail / lightbox view
 *
 * `.rotate()` bakes the EXIF orientation into the pixels before resizing;
 * sharp then drops EXIF (and all other metadata) on re-encode, so no GPS or
 * device metadata ever reaches storage.
 */

export const PHOTO_VARIANTS = {
  thumb: { width: 320, height: 320, quality: 75 },
  card: { width: 1200, height: 1500, quality: 80 },
  full: { width: 1800, height: 2250, quality: 80 },
} as const;

export type ProcessedPhoto = {
  thumb: Buffer;
  card: Buffer;
  full: Buffer;
  /** Dimensions of the card variant (the canonical `Photo.url` image). */
  width: number;
  height: number;
};

export async function processProfilePhoto(input: Buffer): Promise<ProcessedPhoto> {
  // Decode once, bake EXIF orientation, then branch per variant.
  const oriented = sharp(input, { failOn: "error" }).rotate();

  const [thumb, card, full] = await Promise.all([
    oriented
      .clone()
      .resize(PHOTO_VARIANTS.thumb.width, PHOTO_VARIANTS.thumb.height, { fit: "cover" })
      .webp({ quality: PHOTO_VARIANTS.thumb.quality })
      .toBuffer(),
    oriented
      .clone()
      .resize(PHOTO_VARIANTS.card.width, PHOTO_VARIANTS.card.height, { fit: "cover" })
      .webp({ quality: PHOTO_VARIANTS.card.quality })
      .toBuffer(),
    oriented
      .clone()
      .resize(PHOTO_VARIANTS.full.width, PHOTO_VARIANTS.full.height, { fit: "cover" })
      .webp({ quality: PHOTO_VARIANTS.full.quality })
      .toBuffer(),
  ]);

  return {
    thumb,
    card,
    full,
    width: PHOTO_VARIANTS.card.width,
    height: PHOTO_VARIANTS.card.height,
  };
}

/** Tiny 16px-wide WebP as a base64 data URL, used as a blur placeholder. */
export async function makeBlurDataUrl(input: Buffer): Promise<string> {
  const tiny = await sharp(input)
    .rotate()
    .resize(16, 20, { fit: "cover" })
    .webp({ quality: 40 })
    .toBuffer();
  return `data:image/webp;base64,${tiny.toString("base64")}`;
}

export const PHOTOS_BUCKET = "photos";

export class PhotoStorageNotConfiguredError extends Error {
  constructor() {
    super(
      "Photo storage is not configured: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.",
    );
    this.name = "PhotoStorageNotConfiguredError";
  }
}

function assertStorageConfigured() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new PhotoStorageNotConfiguredError();
  }
}

export type UploadedPhoto = {
  /** Storage id shared by the three objects (`${userId}/${photoId}-*.webp`). */
  photoId: string;
  thumbUrl: string;
  cardUrl: string;
  fullUrl: string;
};

export function photoObjectPaths(userId: string, photoId: string) {
  return {
    thumb: `${userId}/${photoId}-thumb.webp`,
    card: `${userId}/${photoId}-card.webp`,
    full: `${userId}/${photoId}-full.webp`,
  } as const;
}

/**
 * Uploads the three variants to the public "photos" bucket under the owner's
 * folder and returns their public URLs. Uses the request-scoped Supabase
 * client so storage RLS sees the authenticated user.
 */
export async function uploadProfilePhoto(
  userId: string,
  buffers: Pick<ProcessedPhoto, "thumb" | "card" | "full">,
): Promise<UploadedPhoto> {
  assertStorageConfigured();

  const supabase = await supabaseServer();
  const photoId = randomUUID();
  const paths = photoObjectPaths(userId, photoId);

  const uploads = [
    { path: paths.thumb, body: buffers.thumb },
    { path: paths.card, body: buffers.card },
    { path: paths.full, body: buffers.full },
  ];

  for (const { path, body } of uploads) {
    const { error } = await supabase.storage.from(PHOTOS_BUCKET).upload(path, body, {
      upsert: true,
      contentType: "image/webp",
    });
    if (error) {
      // Best-effort cleanup of any variants that already landed.
      await supabase.storage
        .from(PHOTOS_BUCKET)
        .remove(uploads.map((u) => u.path))
        .catch(() => undefined);
      throw new Error(`Photo upload failed: ${error.message}`);
    }
  }

  const publicUrl = (path: string) =>
    supabase.storage.from(PHOTOS_BUCKET).getPublicUrl(path).data.publicUrl;

  return {
    photoId,
    thumbUrl: publicUrl(paths.thumb),
    cardUrl: publicUrl(paths.card),
    fullUrl: publicUrl(paths.full),
  };
}

/** Best-effort removal of a photo's storage objects (thumb + card + full). */
export async function deletePhotoObjects(urls: Array<string | null | undefined>): Promise<void> {
  assertStorageConfigured();

  const supabase = await supabaseServer();
  const prefix = `/storage/v1/object/public/${PHOTOS_BUCKET}/`;
  const paths = urls
    .filter((u): u is string => Boolean(u))
    .map((u) => {
      const idx = u.indexOf(prefix);
      return idx === -1 ? null : decodeURIComponent(u.slice(idx + prefix.length).split("?")[0]);
    })
    .filter((p): p is string => Boolean(p));

  if (paths.length === 0) return;
  await supabase.storage
    .from(PHOTOS_BUCKET)
    .remove(paths)
    .catch(() => undefined);
}
