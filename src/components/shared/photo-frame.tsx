"use client";

import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Canonical photo shape for every profile-photo surface. thumbUrl/fullUrl
 * are optional client-side hints - surfaces that only have `url` (or whose
 * upload pipeline has not backfilled variants yet) work unchanged.
 */
export type FramePhoto = {
  url: string;
  blurDataUrl?: string | null;
  thumbUrl?: string | null;
  galleryUrl?: string | null;
  fullUrl?: string | null;
};

export type PhotoFrameVariant = "thumb" | "gallery" | "card" | "full";

type PhotoFrameProps = {
  photo?: FramePhoto | null;
  /** Decorative photos pass "" (the default) - identity lives in the overlay text. */
  alt?: string;
  /**
   * Which stored variant to prefer. Falls back to `url` when the photo
   * object has no thumbUrl/fullUrl (pipeline may not have produced them).
   */
  variant?: PhotoFrameVariant;
  /**
   * "ratio" (default): the frame owns its geometry - canonical 4:5 - and
   * its radius. "fill": absolute inset-0; the PARENT owns geometry and
   * rounding (full-bleed surfaces like the swipe stage and the viewer).
   */
  mode?: "ratio" | "fill";
  /**
   * Radius token. "default" = rounded-[28px] mobile -> rounded-[32px] lg,
   * applied with overflow-hidden on the SAME element so the image reaches
   * exactly the rounded edge - no borders, rings, or inset highlights.
   * "none" for parent-clipped tiles; custom radii go via className.
   */
  radius?: "default" | "none";
  className?: string;
  imgClassName?: string;
  /** Shown when there is no photo - each surface keeps its own fallback. */
  fallback?: React.ReactNode;
  /** Overlay content (scrims, badges, identity blocks) rendered above the image. */
  children?: React.ReactNode;
  draggable?: boolean;
  loading?: "lazy" | "eager";
};

const RADIUS: Record<NonNullable<PhotoFrameProps["radius"]>, string> = {
  default: "rounded-[28px] lg:rounded-[32px]",
  none: "",
};

function pickUrl(photo: FramePhoto, variant: PhotoFrameVariant): string {
  if (variant === "thumb") return photo.thumbUrl ?? photo.url;
  if (variant === "gallery") return photo.galleryUrl ?? photo.url;
  if (variant === "full") return photo.fullUrl ?? photo.url;
  return photo.url;
}

/**
 * The one rendering layer for profile photos: canonical 4:5 ratio,
 * object-cover (never stretched), token radii, and a hardened blur-up
 * (opacity/filter transition + img.complete ref check so the
 * load-before-hydration race never leaves a photo invisible).
 *
 * Download protection is UX-level (Tinder-style), NOT DRM: no context
 * menu, no drag-to-save, no long-press callout, no text/image selection.
 * Screenshots and devtools cannot be stopped and we do not pretend to.
 * pointer-events stay live (swipe drag physics and pinch-zoom depend on
 * them) and alt/role semantics are untouched for screen readers.
 *
 * Tiny circular avatars (chat headers, peek drawer) are NOT photo frames -
 * they stay on Avatar.
 */
export function PhotoFrame({
  photo,
  alt = "",
  variant = "card",
  mode = "ratio",
  radius,
  className,
  imgClassName,
  fallback,
  children,
  draggable = false,
  loading,
}: PhotoFrameProps) {
  const src = photo ? pickUrl(photo, variant) : null;

  // Blur-up: a new src starts hidden and fades/sharpens in. Cached images
  // mark loaded via the ref's `complete` check before first paint.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  // Eternal-blur guard: a one-time fetch failure (expired session tab,
  // flaky network, stale cached error) previously left the blur forever.
  // First error retries once with a cache-busting param; a second error
  // surrenders to the fallback slot instead of an empty blur.
  const [retrySrc, setRetrySrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const loaded = src != null && loadedSrc === src;
  const failed = src != null && failedSrc === src;
  const markLoaded = useCallback((url: string) => {
    setLoadedSrc((current) => (current === url ? current : url));
  }, []);
  const handleError = useCallback((url: string) => {
    setRetrySrc((prev) => {
      if (prev === url) {
        setFailedSrc(url);
        return prev;
      }
      return url;
    });
  }, []);
  const effectiveSrc =
    src != null && retrySrc === src && !failed
      ? `${src}${src.includes("?") ? "&" : "?"}r=1`
      : src;

  return (
    <div
      onContextMenu={(e) => e.preventDefault()}
      className={cn(
        "overflow-hidden",
        mode === "fill"
          ? cn("absolute inset-0", RADIUS[radius ?? "none"])
          : cn("relative w-full aspect-[4/5]", RADIUS[radius ?? "default"]),
        className,
      )}
    >
      {src && photo && !failed ? (
        <>
          {photo.blurDataUrl && (
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url(${photo.blurDataUrl})` }}
            />
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={effectiveSrc ?? src}
            src={effectiveSrc ?? src}
            alt={alt}
            loading={loading}
            draggable={draggable}
            onContextMenu={(e) => e.preventDefault()}
            // Covers the load-before-hydration race: onLoad may never fire
            ref={(el) => {
              if (el?.complete) markLoaded(src);
            }}
            onLoad={() => markLoaded(src)}
            onError={() => handleError(src)}
            className={cn(
              "absolute inset-0 h-full w-full select-none object-cover transition-[opacity,filter] duration-700 ease-out [-webkit-touch-callout:none] [-webkit-user-drag:none]",
              loaded ? "opacity-100 blur-0" : "opacity-0 blur-md",
              imgClassName,
            )}
          />
        </>
      ) : (
        fallback
      )}
      {children}
    </div>
  );
}

/**
 * Contract alias: every surface renders user photos through this one
 * protected component - PhotoFrame IS the ProtectedImage.
 */
export const ProtectedImage = PhotoFrame;
