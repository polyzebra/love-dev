import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { encode as encodeBlurhash } from "blurhash";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Profile photo pipeline built around one canonical 4:5 portrait ratio.
 *
 * Every upload is normalized into four WebP variants (cover-cropped):
 *  - thumb:   320x400   4:5 (tiny previews)
 *  - gallery: 720x900   4:5 (grid tiles: matches, explore, profile gallery)
 *  - card:    1080x1350 4:5 - the canonical variant stored in Photo.url
 *  - full:    1800x2700 2:3 - taller fullscreen SOURCE for the viewer
 *             (source originals are never persisted)
 *
 * `.rotate()` bakes the EXIF orientation into the pixels before resizing;
 * sharp then drops EXIF (and all other metadata) on re-encode, so no GPS or
 * device metadata ever reaches storage.
 *
 * The ORIGINAL upload buffer stays memory-only: it is decoded here, its
 * mime/size are recorded on the Photo row, and only the four re-encoded
 * variants are written to storage. Nothing in this module (or its callers)
 * writes the source bytes to disk or to the bucket.
 */

/**
 * WebP encode quality (spec range 82-86). NOTE, honestly: WebP has no
 * progressive/interlaced mode - `progressive` is a JPEG-only concept in
 * sharp - so we do not (and cannot) request it here. `effort: 5` trades a
 * little CPU for smaller files at the same quality.
 */
const WEBP_QUALITY = 84;
const WEBP_EFFORT = 5;

export const PHOTO_VARIANTS = {
  thumb: { width: 320, height: 400 },
  gallery: { width: 720, height: 900 },
  card: { width: 1080, height: 1350 },
  full: { width: 1800, height: 2700 },
} as const;

export type PhotoVariant = keyof typeof PHOTO_VARIANTS;

export const PHOTO_VARIANT_NAMES = Object.keys(PHOTO_VARIANTS) as PhotoVariant[];

export function isPhotoVariant(value: string): value is PhotoVariant {
  return value in PHOTO_VARIANTS;
}

/**
 * Access rule for the /api/media proxy (pure, unit-testable): the owner
 * always sees their own photos; anyone else only sees ACTIVE photos that
 * are not moderation-REJECTED.
 */
export function canViewPhoto(
  photo: { userId: string; status: string; moderation: string },
  viewerId: string,
): boolean {
  if (photo.userId === viewerId) return true;
  return photo.status === "ACTIVE" && photo.moderation !== "REJECTED";
}

export type ProcessedPhoto = {
  thumb: Buffer;
  gallery: Buffer;
  card: Buffer;
  full: Buffer;
  /** Dimensions of the card variant (the canonical `Photo.url` image). */
  width: number;
  height: number;
  /** Dominant colour of the source image as `#rrggbb`. */
  dominantColor: string;
  /** Blurhash of the source image (4x3 components, encoded from ~32px raw RGBA). */
  blurhash: string;
};

function toHex(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
}

export async function processProfilePhoto(input: Buffer): Promise<ProcessedPhoto> {
  // Decode once, bake EXIF orientation, then branch per variant.
  const oriented = sharp(input, { failOn: "error" }).rotate();

  const resize = (variant: PhotoVariant) =>
    oriented
      .clone()
      .resize(PHOTO_VARIANTS[variant].width, PHOTO_VARIANTS[variant].height, { fit: "cover" })
      .webp({ quality: WEBP_QUALITY, effort: WEBP_EFFORT })
      .toBuffer();

  const [thumb, gallery, card, full, stats, raw] = await Promise.all([
    resize("thumb"),
    resize("gallery"),
    resize("card"),
    resize("full"),
    oriented.clone().stats(),
    // Blurhash input: tiny raw RGBA of the canonical 4:5 crop (~32px wide).
    oriented
      .clone()
      .resize(32, 40, { fit: "cover" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
  ]);

  const { r, g, b } = stats.dominant;
  const dominantColor = `#${toHex(r)}${toHex(g)}${toHex(b)}`;

  const blurhash = encodeBlurhash(
    new Uint8ClampedArray(raw.data),
    raw.info.width,
    raw.info.height,
    4,
    3,
  );

  return {
    thumb,
    gallery,
    card,
    full,
    width: PHOTO_VARIANTS.card.width,
    height: PHOTO_VARIANTS.card.height,
    dominantColor,
    blurhash,
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
  /** Bucket-relative folder holding the four variants (persisted on Photo.storagePath). */
  storagePath: string;
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
    base,
    thumb: `${base}/thumb.webp`,
    gallery: `${base}/gallery.webp`,
    card: `${base}/card.webp`,
    full: `${base}/full.webp`,
  } as const;
}

/**
 * The ONLY URL surface the app stores/serves for profile photos: relative
 * proxy paths resolved by GET /api/media/[photoId]/[variant]. The bucket is
 * private; bytes are only reachable through that authenticated proxy.
 */
export function photoProxyPath(photoId: string, variant: PhotoVariant): string {
  return `/api/media/${photoId}/${variant}`;
}

/**
 * Uploads the four variants to the PRIVATE "listing-images" bucket under the
 * owner's folder. Uses the request-scoped Supabase client so storage RLS sees
 * the authenticated user. Returns the storage id + bucket-relative folder;
 * public URLs are never minted - delivery goes through /api/media.
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

  return { photoId, storagePath: paths.base };
}

/**
 * Best-effort removal of a photo's four storage objects, addressed by the
 * bucket-relative folder persisted in `Photo.storagePath`.
 */
export async function deletePhotoObjects(storagePath: string | null | undefined): Promise<void> {
  if (!storagePath) return;
  assertStorageConfigured();

  const supabase = await supabaseServer();
  const paths = PHOTO_VARIANT_NAMES.map((variant) => `${storagePath}/${variant}.webp`);
  await supabase.storage
    .from(PHOTOS_BUCKET)
    .remove(paths)
    .catch(() => undefined);
}
