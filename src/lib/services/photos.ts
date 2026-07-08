import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Profile photo pipeline built around one canonical 4:5 portrait ratio.
 *
 * Every upload is normalized into four WebP variants (all 4:5, cover-cropped):
 *  - thumb:   320x400  (tiny previews)
 *  - gallery: 720x900  (grid tiles: matches, explore, profile gallery)
 *  - card:    1080x1350 - the canonical variant stored in Photo.url
 *  - full:    1800x2250 - the stored "original" for the fullscreen viewer
 *             (source originals are never persisted)
 *
 * `.rotate()` bakes the EXIF orientation into the pixels before resizing;
 * sharp then drops EXIF (and all other metadata) on re-encode, so no GPS or
 * device metadata ever reaches storage.
 */

export const PHOTO_VARIANTS = {
  thumb: { width: 320, height: 400, quality: 75 },
  gallery: { width: 720, height: 900, quality: 78 },
  card: { width: 1080, height: 1350, quality: 80 },
  full: { width: 1800, height: 2250, quality: 80 },
} as const;

export type ProcessedPhoto = {
  thumb: Buffer;
  gallery: Buffer;
  card: Buffer;
  full: Buffer;
  /** Dimensions of the card variant (the canonical `Photo.url` image). */
  width: number;
  height: number;
};

export async function processProfilePhoto(input: Buffer): Promise<ProcessedPhoto> {
  // Decode once, bake EXIF orientation, then branch per variant.
  const oriented = sharp(input, { failOn: "error" }).rotate();

  const [thumb, gallery, card, full] = await Promise.all([
    oriented
      .clone()
      .resize(PHOTO_VARIANTS.thumb.width, PHOTO_VARIANTS.thumb.height, { fit: "cover" })
      .webp({ quality: PHOTO_VARIANTS.thumb.quality })
      .toBuffer(),
    oriented
      .clone()
      .resize(PHOTO_VARIANTS.gallery.width, PHOTO_VARIANTS.gallery.height, { fit: "cover" })
      .webp({ quality: PHOTO_VARIANTS.gallery.quality })
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
    gallery,
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

export const PHOTOS_BUCKET = "listing-images";

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
  /** Storage id shared by the four objects (`users/{userId}/photos/{photoId}/*.webp`). */
  photoId: string;
  thumbUrl: string;
  galleryUrl: string;
  cardUrl: string;
  fullUrl: string;
};

/**
 * Canonical object paths in the "listing-images" bucket:
 * `users/{userId}/photos/{photoId}/{thumb|gallery|card|full}.webp`.
 * Storage RLS keys off `(storage.foldername(name))[2] = auth.uid()`, so the
 * second folder segment MUST be the owner's auth uid.
 */
export function photoObjectPaths(userId: string, photoId: string) {
  const base = `users/${userId}/photos/${photoId}`;
  return {
    thumb: `${base}/thumb.webp`,
    gallery: `${base}/gallery.webp`,
    card: `${base}/card.webp`,
    full: `${base}/full.webp`,
  } as const;
}

/**
 * Extracts the bucket-relative object path from a public URL previously
 * produced by `getPublicUrl` for the listing-images bucket. Returns null for
 * URLs that do not point at this bucket.
 */
export function parsePhotoObjectPath(url: string): string | null {
  const prefix = `/storage/v1/object/public/${PHOTOS_BUCKET}/`;
  const idx = url.indexOf(prefix);
  if (idx === -1) return null;
  return decodeURIComponent(url.slice(idx + prefix.length).split("?")[0]);
}

/**
 * Uploads the four variants to the public "listing-images" bucket under the
 * owner's folder and returns their public URLs. Uses the request-scoped
 * Supabase client so storage RLS sees the authenticated user.
 */
export async function uploadProfilePhoto(
  userId: string,
  buffers: Pick<ProcessedPhoto, "thumb" | "gallery" | "card" | "full">,
): Promise<UploadedPhoto> {
  assertStorageConfigured();

  const supabase = await supabaseServer();
  const photoId = randomUUID();
  const paths = photoObjectPaths(userId, photoId);

  const uploads = [
    { path: paths.thumb, body: buffers.thumb },
    { path: paths.gallery, body: buffers.gallery },
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
    galleryUrl: publicUrl(paths.gallery),
    cardUrl: publicUrl(paths.card),
    fullUrl: publicUrl(paths.full),
  };
}

/** Best-effort removal of a photo's storage objects (thumb + gallery + card + full). */
export async function deletePhotoObjects(urls: Array<string | null | undefined>): Promise<void> {
  assertStorageConfigured();

  const supabase = await supabaseServer();
  const paths = urls
    .filter((u): u is string => Boolean(u))
    .map((u) => parsePhotoObjectPath(u))
    .filter((p): p is string => Boolean(p));

  if (paths.length === 0) return;
  await supabase.storage
    .from(PHOTOS_BUCKET)
    .remove(paths)
    .catch(() => undefined);
}
