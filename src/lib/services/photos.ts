import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { encode as encodeBlurhash } from "blurhash";
import { storageClient } from "@/lib/storage";

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
  return Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, "0");
}

/**
 * A generated variant failed post-encode validation. The upload is aborted
 * before anything reaches storage or the database; the caller answers a
 * structured 422. The ORIGINAL upload stays with the user - it is never
 * persisted anywhere (see module doc), so an abort loses nothing of theirs.
 */
export class PhotoProcessingError extends Error {
  constructor(
    message: string,
    /** Full per-variant diagnostics for the audit log - no image bytes. */
    readonly diagnostics: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PhotoProcessingError";
  }
}

/**
 * A stored object's bytes do not match what we uploaded. This is the exact
 * failure that produced the 2026-07 "blank white photos": on Vercel the
 * fetch that carries the storage upload coerced Node Buffer bodies through
 * a UTF-8 string round-trip, replacing every byte >= 0x80 with EF BF BD
 * (U+FFFD) and leaving undecodable WebP in the bucket. Uploads now (a) send
 * Blobs, which survive that path, and (b) verify by re-downloading. On
 * mismatch everything is removed and the caller answers 502 - corrupt bytes
 * are never left behind.
 */
export class PhotoUploadIntegrityError extends Error {
  constructor(
    message: string,
    readonly diagnostics: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PhotoUploadIntegrityError";
  }
}

/**
 * Below this max per-channel RGB stdev an image is "near-uniform" (blank to
 * the eye). Outputs under it are rejected UNLESS the input itself was
 * near-uniform - a legitimately plain photo must not be rejected harder
 * than its input.
 */
const BLANK_MAX_STDEV = 3;

/** Encoded variants smaller than this are suspicious for real photos. */
const MIN_VARIANT_BYTES = 1024;

export type InputImageProfile = {
  /**
   * Max per-channel stdev of the RAW decoded source (sharp `.stats()` reads
   * the input image, before flatten/resize), across ALL channels including
   * alpha. A genuinely plain photo (solid wall) is near-uniform here and is
   * never rejected for producing plain variants; a patterned-but-transparent
   * PNG is NOT near-uniform here, so its blank flattened output is rejected
   * honestly instead of being stored as a white rectangle.
   */
  maxStdev: number;
};

type DecodedVariant = {
  width?: number;
  height?: number;
  channels?: number;
  format?: string;
  maxStdev: number;
};

async function decodeVariant(buffer: Buffer): Promise<DecodedVariant> {
  const meta = await sharp(buffer).metadata();
  const stats = await sharp(buffer).stats();
  return {
    width: meta.width,
    height: meta.height,
    channels: meta.channels,
    format: meta.format,
    maxStdev: Math.max(...stats.channels.slice(0, 3).map((c) => c.stdev)),
  };
}

/**
 * Decode-and-verify one freshly encoded variant. Checks exact dimensions,
 * webp format, 3 opaque channels (alpha must have been flattened away),
 * a sane byte size, and that the output is not near-uniform/blank unless
 * the INPUT was itself near-uniform (plain photos stay accepted - both the
 * byte floor and the blankness check are input-relative for that reason).
 * Throws PhotoProcessingError with full diagnostics on any failure.
 */
export async function validateProcessedVariant(
  variant: PhotoVariant,
  buffer: Buffer,
  input: InputImageProfile,
  decode: (buffer: Buffer) => Promise<DecodedVariant> = decodeVariant,
): Promise<void> {
  const expected = PHOTO_VARIANTS[variant];
  const fail = (reason: string, decoded?: DecodedVariant) => {
    throw new PhotoProcessingError(`Variant "${variant}" failed validation: ${reason}`, {
      variant,
      reason,
      expected: { ...expected, channels: 3, format: "webp", minBytes: MIN_VARIANT_BYTES },
      actual: decoded
        ? { ...decoded, maxStdev: Number(decoded.maxStdev.toFixed(2)), bytes: buffer.length }
        : { bytes: buffer.length },
      inputMaxStdev: Number(input.maxStdev.toFixed(2)),
    });
  };

  let decoded: DecodedVariant;
  try {
    decoded = await decode(buffer);
  } catch (error) {
    return fail(`output does not decode: ${(error as Error).message}`);
  }

  if (decoded.format !== "webp") return fail(`format is ${decoded.format}, expected webp`, decoded);
  if (decoded.width !== expected.width || decoded.height !== expected.height) {
    return fail(
      `dimensions are ${decoded.width}x${decoded.height}, expected ${expected.width}x${expected.height}`,
      decoded,
    );
  }
  if (decoded.channels !== 3) {
    return fail(
      `has ${decoded.channels} channels, expected 3 opaque (alpha must be flattened)`,
      decoded,
    );
  }
  const inputNearUniform = input.maxStdev < BLANK_MAX_STDEV;
  if (buffer.length < MIN_VARIANT_BYTES && !inputNearUniform) {
    return fail(`only ${buffer.length} bytes (< ${MIN_VARIANT_BYTES})`, decoded);
  }
  // Near-uniform output from a non-uniform input = the transform destroyed
  // the picture. A near-uniform INPUT (plain wall, solid backdrop) is the
  // user's actual photo and passes.
  if (decoded.maxStdev < BLANK_MAX_STDEV && !inputNearUniform) {
    return fail(
      `output is near-uniform/blank (max stdev ${decoded.maxStdev.toFixed(2)}) while input was not (${input.maxStdev.toFixed(2)})`,
      decoded,
    );
  }
}

export async function processProfilePhoto(input: Buffer): Promise<ProcessedPhoto> {
  // Sniff BEFORE transforming so failures can be diagnosed from logs alone.
  const inputMeta = await sharp(input, { failOn: "error" }).metadata();
  console.info(
    `[photos:pipeline] input bytes=${input.length} format=${inputMeta.format} ` +
      `dims=${inputMeta.width}x${inputMeta.height} channels=${inputMeta.channels} hasAlpha=${inputMeta.hasAlpha}`,
  );

  // Decode once, bake EXIF orientation, composite onto an OPAQUE WHITE
  // background (kills alpha deterministically - a transparent PNG previously
  // kept its alpha through resize+webp and rendered "blank white" on white
  // surfaces), then branch per variant.
  const oriented = sharp(input, { failOn: "error" }).rotate().flatten({ background: "#ffffff" });

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

  // Blankness baseline over ALL source channels incl. alpha - see the
  // InputImageProfile doc for why (plain photos pass, transparent-patterned
  // sources that flatten to blank are rejected).
  const inputProfile: InputImageProfile = {
    maxStdev: Math.max(...stats.channels.map((c) => c.stdev)),
  };

  const variants = { thumb, gallery, card, full } as const;
  for (const variant of PHOTO_VARIANT_NAMES) {
    await validateProcessedVariant(variant, variants[variant], inputProfile);
    const { width, height } = PHOTO_VARIANTS[variant];
    console.info(
      `[photos:pipeline] variant=${variant} ok bytes=${variants[variant].length} dims=${width}x${height}`,
    );
  }

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
    .flatten({ background: "#ffffff" })
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
 * ETag for the /api/media proxy. Bytes behind photoId+variant only change
 * when a repair/reprocess rewrites the objects in place, which bumps
 * Photo.mediaVersion - so the version is part of the tag and clients
 * holding the previous immutable response refetch after a reprocess.
 */
export function mediaEtag(photoId: string, variant: PhotoVariant, mediaVersion: number): string {
  return `"${photoId}-${variant}-v${mediaVersion}"`;
}

/**
 * Uploads the four variants to the PRIVATE "listing-images" bucket under the
 * owner's folder. Uses the request-scoped Supabase client so storage RLS sees
 * the authenticated user. Returns the storage id + bucket-relative folder;
 * public URLs are never minted - delivery goes through /api/media.
 *
 * Binary-safety hardening (see PhotoUploadIntegrityError): bodies are sent
 * as Blobs - a raw Node Buffer body was UTF-8-mangled by the platform fetch
 * on Vercel - and every stored object is downloaded back and byte-compared
 * before the upload is considered successful. On any mismatch all objects
 * are removed and nothing is recorded.
 */
export async function uploadProfilePhoto(
  userId: string,
  buffers: Pick<ProcessedPhoto, "thumb" | "gallery" | "card" | "full">,
  existingPhotoId?: string,
): Promise<UploadedPhoto> {
  assertStorageConfigured();

  const supabase = await storageClient();
  const photoId = existingPhotoId ?? randomUUID();
  const paths = photoObjectPaths(userId, photoId);

  const uploads = PHOTO_VARIANT_NAMES.map((variant) => ({
    variant,
    path: paths[variant],
    body: buffers[variant],
  }));

  const cleanup = () =>
    supabase.storage
      .from(PHOTOS_BUCKET)
      .remove(uploads.map((u) => u.path))
      .catch(() => undefined);

  for (const { variant, path, body } of uploads) {
    const { error } = await supabase.storage
      .from(PHOTOS_BUCKET)
      .upload(path, new Blob([new Uint8Array(body)], { type: "image/webp" }), {
        upsert: true,
        contentType: "image/webp",
      });
    if (error) {
      // Best-effort cleanup of any variants that already landed.
      await cleanup();
      throw new Error(`Photo upload failed: ${error.message}`);
    }

    // Verify what actually landed: download back and byte-compare.
    const { data, error: downloadError } = await supabase.storage
      .from(PHOTOS_BUCKET)
      .download(path);
    const stored = data ? Buffer.from(await data.arrayBuffer()) : null;
    if (downloadError || !stored || !stored.equals(body)) {
      await cleanup();
      throw new PhotoUploadIntegrityError(
        `Stored object does not match uploaded bytes for "${variant}"`,
        {
          variant,
          path,
          uploadedBytes: body.length,
          storedBytes: stored?.length ?? null,
          downloadError: downloadError?.message ?? null,
          // The mangling signature: UTF-8 replacement sequences in storage.
          storedHasUtf8ReplacementChar: stored?.includes(Buffer.from([0xef, 0xbf, 0xbd])) ?? null,
        },
      );
    }

    const { width, height } = PHOTO_VARIANTS[variant];
    console.info(
      `[photos:upload] variant=${variant} ok bytes=${body.length} dims=${width}x${height} path=${PHOTOS_BUCKET}/${path}`,
    );
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

  const supabase = await storageClient();
  const paths = PHOTO_VARIANT_NAMES.map((variant) => `${storagePath}/${variant}.webp`);
  await supabase.storage
    .from(PHOTOS_BUCKET)
    .remove(paths)
    .catch(() => undefined);
}
