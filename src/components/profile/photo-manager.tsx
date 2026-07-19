"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion, type PanInfo } from "motion/react";
import { toast } from "sonner";
import { Camera, Heart, MapPin, Settings, Trash2 } from "lucide-react";
import { VerifiedBadge } from "@/components/shared/verified-badge";
import { PHOTO_LIMITS } from "@/lib/constants";
import { SPRING } from "@/lib/motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PhotoFrame } from "@/components/shared/photo-frame";
import { Reveal } from "@/components/fx/reveal";
import { cn } from "@/lib/utils";

/**
 * Serializable photo shape passed from the profile RSC. Position/isCover are
 * carried for completeness - render order is the array order, index 0 is the
 * cover (mirrors the reorder API contract).
 */
export type ManagedPhoto = {
  id: string;
  url: string;
  thumbUrl?: string | null;
  galleryUrl?: string | null;
  fullUrl?: string | null;
  blurDataUrl?: string | null;
  position?: number;
  isCover?: boolean;
};

type PhotoManagerProps = {
  initialPhotos: ManagedPhoto[];
  completionPct: number;
  displayName: string;
  age: number;
  city: string | null;
  country: string;
  goalLabel: string;
  photoVerified: boolean;
  /** Seed for the empty-state cover gradient (only shown with zero photos). */
  gradientSeed: string;
  /** Sections rendered between the cover and the gallery (trust rail). */
  children?: React.ReactNode;
};

function coverGradient(seed: string): string {
  const hues = [346, 12, 262, 200];
  const h = hues[seed.charCodeAt(0) % hues.length];
  return `linear-gradient(165deg, hsl(${h} 70% 60%) 0%, hsl(${h} 75% 38%) 50%, hsl(${h} 70% 18%) 100%)`;
}

/** SVG completion ring with the score in the centre. */
function CompletionRing({ value }: { value: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div
      className="relative flex size-16 items-center justify-center"
      aria-label={`Profile ${value}% complete`}
    >
      <svg viewBox="0 0 64 64" className="absolute inset-0 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="4" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke="url(#ring-grad)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - value / 100)}
        />
        <defs>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fb7185" />
            <stop offset="100%" stopColor="#e7c9a1" />
          </linearGradient>
        </defs>
      </svg>
      <span className="text-sm font-semibold text-white tabular-nums">{value}%</span>
    </div>
  );
}

/** Pull the server's `{ error: { message } }` envelope out of a failed response. */
async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body?.error?.message) return body.error.message;
  } catch {
    // Non-JSON body (proxy/network errors) - use the fallback copy.
  }
  return fallback;
}

/**
 * Owns the cover hero AND the gallery grid so every mutation (add, reorder,
 * delete) updates both optimistically - index 0 of local state is always the
 * hero. `router.refresh()` follows successful upload/delete so RSC-derived
 * state (completion %, verify nudge) catches up behind the already-correct
 * UI; reorder skips it - no server-derived UI depends on order.
 */
export function PhotoManager({
  initialPhotos,
  completionPct,
  displayName,
  age,
  city,
  country,
  goalLabel,
  photoVerified,
  gradientSeed,
  children,
}: PhotoManagerProps) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [photos, setPhotos] = useState<ManagedPhoto[]>(initialPhotos);
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ManagedPhoto | null>(null);

  // After router.refresh() the RSC sends fresh props - let server truth win
  // so local state never drifts from the database. (Render-time state sync,
  // per React's "storing information from previous renders" pattern.)
  const [prevInitial, setPrevInitial] = useState(initialPhotos);
  if (prevInitial !== initialPhotos) {
    setPrevInitial(initialPhotos);
    setPhotos(initialPhotos);
  }

  const cover = photos[0] ?? null;

  async function uploadPhoto(file: File) {
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/photos", { method: "POST", body });
      if (!res.ok) {
        toast.error(
          await readErrorMessage(res, "We could not upload that photo. Please try again."),
        );
        return;
      }
      const json = (await res.json()) as { data: ManagedPhoto };
      setPhotos((current) => [...current, json.data]);
      router.refresh();
    } catch {
      toast.error("We could not upload that photo. Check your connection and try again.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  /**
   * The ONE optimistic reorder commit - drag-drop
   * land here: PATCH the new order, revert to `previous` + toast on failure.
   */
  async function commitOrder(next: ManagedPhoto[], previous: ManagedPhoto[]) {
    try {
      const res = await fetch("/api/photos/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: next.map((p) => p.id) }),
      });
      if (!res.ok) {
        setPhotos(previous);
        toast.error(
          await readErrorMessage(res, "We could not reorder your photos. Please try again."),
        );
        return;
      }
      // No refresh(): unlike upload/delete, reorder changes no server-derived
      // UI (completionPct, verify nudge) - local order IS the server order now.
    } catch {
      setPhotos(previous);
      toast.error("We could not reorder your photos. Check your connection and try again.");
    }
  }

  // ---- Drag to reorder (pointer-based swap - the ONLY reorder control
  // since the profile polish removed the chevron buttons; keyboard users
  // can re-pick the cover via delete/re-upload order). Grid drag is
  // axis-free, so Reorder.Group (single axis) is a poor fit - instead each
  // tile is draggable and swaps with the grid cell under the pointer.
  const tileRefs = useRef(new Map<string, HTMLDivElement>());
  const slotRects = useRef<DOMRect[]>([]);
  const dragStartOrder = useRef<ManagedPhoto[] | null>(null);
  const suppressClick = useRef(false); // a drag must never fire tile buttons
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // Drag callbacks close over stale state - mirror the latest order.
  // (Synced in an effect: refs must not be written during render.)
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  function beginDrag(photoId: string) {
    dragStartOrder.current = photosRef.current;
    suppressClick.current = true;
    setDraggingId(photoId);
    // Freeze slot geometry at drag start: pointer targets are the STATIC
    // grid cells. Measuring live tiles mid-layout-animation would make
    // swaps jitter back and forth as tiles fly past the pointer.
    slotRects.current = photosRef.current.map(
      (p) => tileRefs.current.get(p.id)?.getBoundingClientRect() ?? new DOMRect(0, 0, 0, 0),
    );
  }

  function dragOver(photoId: string, info: PanInfo) {
    // info.point is page-relative; slot rects are viewport-relative.
    const x = info.point.x - window.scrollX;
    const y = info.point.y - window.scrollY;
    const slot = slotRects.current.findIndex(
      (r) => r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom,
    );
    if (slot === -1) return;
    setPhotos((current) => {
      const from = current.findIndex((p) => p.id === photoId);
      if (from === -1 || from === slot || slot >= current.length) return current;
      const next = [...current];
      [next[from], next[slot]] = [next[slot], next[from]];
      return next;
    });
  }

  function endDrag() {
    setDraggingId(null);
    window.setTimeout(() => (suppressClick.current = false), 150);
    const previous = dragStartOrder.current;
    dragStartOrder.current = null;
    const next = photosRef.current;
    if (!previous) return;
    const changed = next.some((p, i) => p.id !== previous[i]?.id);
    if (changed) void commitOrder(next, previous);
  }

  async function deletePhoto(photo: ManagedPhoto) {
    setDeleteTarget(null);
    const previous = photos;
    setPhotos((current) => current.filter((p) => p.id !== photo.id));

    try {
      const res = await fetch(`/api/photos/${photo.id}`, { method: "DELETE" });
      if (!res.ok) {
        setPhotos(previous);
        toast.error(
          await readErrorMessage(res, "We could not delete that photo. Please try again."),
        );
        return;
      }
      router.refresh();
    } catch {
      setPhotos(previous);
      toast.error("We could not delete that photo. Check your connection and try again.");
    }
  }

  const controlClass =
    // Controls sit on photo material - a white ring is the neutral there.
    "glass-chip flex items-center justify-center rounded-full text-white outline-none transition-all focus-visible:ring-2 focus-visible:ring-white/60 hover:brightness-110 active:scale-95";

  return (
    <>
      {/* ================= COVER - canonical 4:5 card ================= */}
      <Reveal y={16}>
        <section className="relative mx-auto w-full max-w-[600px]">
          <PhotoFrame
            photo={cover}
            alt="Your cover photo"
            variant="card"
            className="shadow-float"
            fallback={
              <div
                className="absolute inset-0"
                style={{ background: coverGradient(gradientSeed) }}
              />
            }
          >
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-black/10" />
            <div className="absolute inset-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]" />

            {/* Top rail: completion + edit */}
            <div className="absolute inset-x-5 top-5 flex items-start justify-between">
              <CompletionRing value={completionPct} />
              <Button
                size="icon"
                variant="secondary"
                className="glass-chip size-11 rounded-full border-0 lg:hidden"
                aria-label="Settings"
                asChild
              >
                <Link href="/settings">
                  <Settings className="size-5" aria-hidden="true" />
                </Link>
              </Button>
            </div>

            {/* Identity - editorial lockup */}
            <div className="absolute inset-x-0 bottom-0 space-y-3 p-6 md:p-9">
              <h1 className="font-display flex flex-wrap items-center gap-3 text-[clamp(2.2rem,6vw,4rem)] leading-none font-medium tracking-tight text-white">
                {displayName}, {age}
                {photoVerified && (
                  <span className="relative flex items-center justify-center">
                    <span
                      className="animate-ping-soft absolute size-8 rounded-full bg-sky-400/25"
                      aria-hidden="true"
                    />
                    <VerifiedBadge
                      className="relative text-[30px]"
                      iconClassName="fill-sky-400 text-white"
                    />
                  </span>
                )}
              </h1>
              <p className="flex items-center gap-1.5 text-sm text-white/80">
                <MapPin className="size-4" aria-hidden="true" />
                {city}
                {country === "IE" ? ", Ireland" : ", UK"}
              </p>
              <Badge className="rounded-full border-0 bg-white/15 px-4 py-1.5 text-white backdrop-blur-md">
                <Heart className="size-3.5 fill-current" aria-hidden="true" />
                {goalLabel}
              </Badge>
            </div>
          </PhotoFrame>
        </section>
      </Reveal>

      {children}

      {/* ================= GALLERY ================= */}
      <Reveal>
        <section>
          <div className="mb-3 flex items-baseline justify-between px-1">
            <p className="text-gold text-xs font-semibold tracking-[0.3em] uppercase">Gallery</p>
            <p className="text-muted-foreground text-xs">
              {photos.length}/{PHOTO_LIMITS.max} photos
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            {photos.map((photo, i) => (
              <motion.div
                key={photo.id}
                layout
                transition={reduced ? { duration: 0 } : SPRING.standard}
                ref={(el) => {
                  if (el) tileRefs.current.set(photo.id, el);
                  else tileRefs.current.delete(photo.id);
                }}
                drag={photos.length > 1}
                dragSnapToOrigin
                dragMomentum={false}
                onDragStart={() => beginDrag(photo.id)}
                onDrag={(_, info) => dragOver(photo.id, info)}
                onDragEnd={endDrag}
                whileDrag={{
                  scale: 1.03,
                  boxShadow: "0 16px 40px rgba(0,0,0,0.35)",
                  transition: reduced ? { duration: 0 } : SPRING.snappy,
                }}
                className={cn(
                  "relative rounded-2xl",
                  draggingId === photo.id
                    ? "z-20 cursor-grabbing"
                    : photos.length > 1 && "cursor-grab",
                )}
              >
                <PhotoFrame
                  photo={photo}
                  alt={i === 0 ? "Cover photo" : `Photo ${i + 1}`}
                  variant="gallery"
                  loading="lazy"
                  radius="none"
                  className="border-border rounded-2xl border"
                >
                  {i === 0 && (
                    <span className="glass-chip absolute top-2 left-2 rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-[0.18em] text-white uppercase">
                      Cover
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (!suppressClick.current) setDeleteTarget(photo);
                    }}
                    aria-label={i === 0 ? "Delete cover photo" : `Delete photo ${i + 1}`}
                    className={`${controlClass} absolute top-1.5 right-1.5 size-9`}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </PhotoFrame>
              </motion.div>
            ))}
            {photos.length < PHOTO_LIMITS.max && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="border-foreground/15 text-muted-foreground hover:border-foreground/25 hover:text-foreground flex aspect-[4/5] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed transition-colors disabled:pointer-events-none"
                aria-label="Add photo"
                aria-busy={uploading}
              >
                {uploading ? (
                  <span
                    aria-hidden="true"
                    className="border-foreground/20 border-t-primary size-5 animate-spin rounded-full border-2"
                  />
                ) : (
                  <Camera className="size-5" aria-hidden="true" />
                )}
                <span className="text-[11px] font-medium">
                  {uploading ? "Uploading" : "Add photo"}
                </span>
              </button>
            )}
          </div>
          {photos.length < PHOTO_LIMITS.min && (
            <p className="text-warning mt-2 px-1 text-xs">
              Add at least {PHOTO_LIMITS.min} photos to appear in Discover.
            </p>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadPhoto(file);
            }}
          />
        </section>
      </Reveal>

      {/* Delete confirmation */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="rounded-3xl sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this photo?</DialogTitle>
            <DialogDescription>
              It will be removed from your profile straight away. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" className="rounded-2xl" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="rounded-2xl"
              onClick={() => deleteTarget && void deletePhoto(deleteTarget)}
            >
              Delete photo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
