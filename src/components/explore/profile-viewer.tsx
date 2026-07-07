"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { toast } from "sonner";
import { BadgeCheck, Heart, MapPin, RotateCcw, Sparkles, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OnlineDot } from "@/components/shared/online-dot";
import { emitInteraction } from "@/lib/interaction-events";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type ViewerProfile = {
  userId: string;
  displayName: string;
  age: number;
  bio: string | null;
  city: string | null;
  country: string;
  relationshipGoal: string;
  isVerified: boolean;
  isOnline: boolean;
  photos: { url: string; blurDataUrl: string | null }[];
  interests: { label: string; shared: boolean }[];
};

const GOAL_LABELS: Record<string, string> = {
  LONG_TERM: "Long-term relationship",
  SHORT_TERM: "Something casual",
  OPEN_TO_EITHER: "Open to either",
  FRIENDSHIP: "New friends",
  FIGURING_OUT: "Figuring it out",
};

function sendEvent(name: string, data?: Record<string, string | number | boolean>) {
  void fetch("/api/analytics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, data }),
  }).catch(() => {});
}

function fallbackGradient(seed: string): string {
  const hues = [346, 12, 262, 200, 160];
  const h = hues[seed.charCodeAt(0) % hues.length];
  return `linear-gradient(160deg, hsl(${h} 80% 72%) 0%, hsl(${h} 72% 48%) 55%, hsl(${h} 70% 26%) 100%)`;
}

/**
 * Immersive full-screen profile viewer (modal route ?profile=<id>).
 * Covers the app chrome entirely; browser back closes it and Explore
 * keeps its scroll position (all navigation is scroll: false).
 */
export type QueueEntry = { userId: string; photoUrl: string | null };

export function ExploreProfileViewer({
  profile: initialProfile,
  queue,
  slug,
}: {
  profile: ViewerProfile;
  queue: QueueEntry[];
  slug: string;
}) {
  const router = useRouter();
  const [profile, setProfile] = useState<ViewerProfile>(initialProfile);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [acted, setActed] = useState<Set<string>>(new Set());
  const photos = profile.photos;
  const hasPhotos = photos.length > 0;

  // Preload the next queue profile's first photo for a seamless advance
  useEffect(() => {
    const next = queue.find((q) => q.userId !== profile.userId && !acted.has(q.userId));
    if (next?.photoUrl) {
      const img = new Image();
      img.src = next.photoUrl;
    }
  }, [profile.userId, acted, queue]);

  const advance = useCallback(
    async (from: string) => {
      const remaining = queue.filter((q) => q.userId !== from && !acted.has(q.userId));
      for (const entry of remaining) {
        const res = await fetch(`/api/explore/profile/${entry.userId}`);
        if (res.ok) {
          const { data } = (await res.json()) as { data: ViewerProfile };
          setProfile(data);
          setPhotoIndex(0);
          x.set(0);
          // keep the modal route alive; replace so Back still exits to grid
          router.replace(`/explore/${slug}?profile=${entry.userId}`, { scroll: false });
          return;
        }
        // profile became unavailable (blocked/hidden) - skip it
        setActed((prev) => new Set(prev).add(entry.userId));
      }
      setExhausted(true);
      router.replace(`/explore/${slug}`, { scroll: false });
    },
    [queue, acted, router, slug],
  );

  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-8, 8]);
  const likeOpacity = useTransform(x, [30, 110], [0, 1]);
  const passOpacity = useTransform(x, [-110, -30], [1, 0]);

  const close = useCallback(() => {
    sendEvent("explore_profile_closed", { userId: profile.userId });
    router.back();
  }, [router, profile.userId]);

  // Open/close lifecycle: analytics, Escape, body scroll lock
  useEffect(() => {
    sendEvent("explore_profile_opened", { userId: profile.userId });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [close, profile.userId]);

  function changePhoto(dir: 1 | -1) {
    if (photos.length < 2) return;
    setPhotoIndex((i) => {
      const next = Math.min(Math.max(i + dir, 0), photos.length - 1);
      if (next !== i) sendEvent("explore_profile_photo_changed", { userId: profile.userId, index: next });
      return next;
    });
  }

  async function decide(action: "LIKE" | "PASS" | "SUPER_LIKE") {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/swipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toId: profile.userId, action }),
      });
      if (res.status === 402) {
        const payload = await res.json().catch(() => null);
        toast(payload?.error?.message ?? "Daily limit reached.");
        return;
      }
      if (!res.ok) {
        toast.error("Something went wrong. Try again.");
        return;
      }
      emitInteraction(action === "LIKE" ? "like" : action === "PASS" ? "pass" : "superlike");
      sendEvent(action === "PASS" ? "explore_profile_passed" : "explore_profile_liked", {
        userId: profile.userId,
        action,
      });
      const { data } = (await res.json()) as { data: { matched: boolean } };
      if (data.matched) {
        emitInteraction("match");
        toast.success(`It's a match with ${profile.displayName}!`, {
          action: { label: "Say hello", onClick: () => router.push("/chat") },
        });
      }
      // Animate the card away, then advance IN PLACE - never back to grid
      const dir = action === "PASS" ? -1 : 1;
      animate(x, dir * window.innerWidth * 1.1, { type: "spring", stiffness: 110, damping: 18 });
      const departed = profile.userId;
      setActed((prev) => new Set(prev).add(departed));
      window.setTimeout(() => void advance(departed), 220);
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    const res = await fetch("/api/swipes", { method: "DELETE" });
    if (res.status === 402) toast("Undo is a Plus feature.");
    else if (res.ok) toast.success("Last swipe undone.");
    else toast("Nothing to undo yet.");
  }

  if (exhausted) {
    return (
      <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-5 bg-background p-8 text-center" role="dialog" aria-modal="true" aria-label="All caught up">
        <span className="glass-chip flex size-16 items-center justify-center rounded-full">
          <Sparkles className="size-7 text-gold" aria-hidden="true" />
        </span>
        <h2 className="font-display text-3xl font-medium tracking-tight">You&apos;re all caught up</h2>
        <p className="max-w-xs text-sm text-muted-foreground">
          You&apos;ve seen everyone here for now. New people join every day.
        </p>
        <Button className="h-12 rounded-full px-8" onClick={() => router.push(`/explore/${slug}`, { scroll: false })}>
          Back to Explore
        </Button>
      </div>
    );
  }

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={`${profile.displayName}, ${profile.age}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[70] flex flex-col bg-background"
    >
      <div className="safe-top relative mx-auto flex h-full w-full max-w-md flex-col p-3">
        {/* Photo card */}
        <motion.div
          className="relative flex-1 touch-none overflow-hidden rounded-[30px] border border-white/12 shadow-float"
          style={{ x, rotate }}
          drag={busy ? false : "x"}
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.8}
          onDragEnd={(_, info) => {
            if (info.offset.x > 110 || info.velocity.x > 600) void decide("LIKE");
            else if (info.offset.x < -110 || info.velocity.x < -600) void decide("PASS");
          }}
          transition={SPRING.standard}
        >
          {hasPhotos ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photos[photoIndex].url} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
          ) : (
            <div className="absolute inset-0" style={{ background: fallbackGradient(profile.userId) }} />
          )}
          <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/90 via-black/35 to-transparent" />
          <div className="absolute inset-0 rounded-[30px] shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]" />

          {/* Photo progress bars */}
          {photos.length > 1 && (
            <div className="absolute inset-x-3 top-3 flex gap-1.5" aria-label={`Photo ${photoIndex + 1} of ${photos.length}`}>
              {photos.map((_, i) => (
                <span key={i} className={cn("h-1 flex-1 rounded-full transition-colors", i <= photoIndex ? "bg-white/90" : "bg-white/25")} />
              ))}
            </div>
          )}

          {/* Tap zones for photo navigation */}
          <button type="button" aria-label="Previous photo" className="absolute inset-y-0 left-0 w-1/3" onClick={() => changePhoto(-1)} />
          <button type="button" aria-label="Next photo" className="absolute inset-y-0 right-0 w-1/3" onClick={() => changePhoto(1)} />

          {/* Verdict stamps while dragging */}
          <motion.span style={{ opacity: likeOpacity }} aria-hidden="true" className="absolute left-6 top-12 -rotate-12 rounded-2xl border-4 border-emerald-400 px-4 py-1 text-2xl font-extrabold uppercase tracking-widest text-emerald-400">Like</motion.span>
          <motion.span style={{ opacity: passOpacity }} aria-hidden="true" className="absolute right-6 top-12 rotate-12 rounded-2xl border-4 border-white/85 px-4 py-1 text-2xl font-extrabold uppercase tracking-widest text-white/85">Pass</motion.span>

          {/* Close / super */}
          <div className="absolute inset-x-3 top-7 flex items-start justify-between">
            <Button variant="secondary" size="icon" className="glass-chip size-11 rounded-full border-0" aria-label="Close profile" onClick={close}>
              <X className="size-5" />
            </Button>
            <Button variant="secondary" size="icon" className="glass-chip size-11 rounded-full border-0" aria-label="Super Like" disabled={busy} onClick={() => decide("SUPER_LIKE")}>
              <Star className="size-5 fill-sky-400 text-sky-400" />
            </Button>
          </div>

          {/* Identity */}
          <div className="absolute inset-x-0 bottom-0 space-y-2.5 p-5 pb-6">
            <p className="flex items-center gap-2 text-3xl font-semibold tracking-tight text-white">
              {profile.displayName}, {profile.age}
              {profile.isVerified && (
                <span role="img" aria-label="Photo verified" className="relative flex items-center justify-center">
                  <span className="absolute size-6 animate-ping-soft rounded-full bg-sky-400/25" />
                  <BadgeCheck className="relative size-6 fill-sky-400 text-white" />
                </span>
              )}
              <OnlineDot online={profile.isOnline} className="ml-1" />
            </p>
            <div className="flex flex-wrap items-center gap-2 text-sm text-white/85">
              <span className="glass-chip rounded-full px-3 py-1 text-xs font-medium">
                Looking for · {GOAL_LABELS[profile.relationshipGoal] ?? "Connection"}
              </span>
              {profile.city && (
                <span className="flex items-center gap-1 text-xs">
                  <MapPin className="size-3.5" aria-hidden="true" />
                  {profile.city}, {profile.country === "IE" ? "Ireland" : "UK"}
                </span>
              )}
            </div>
            {profile.bio && <p className="line-clamp-2 text-sm/relaxed text-white/90">{profile.bio}</p>}
            {profile.interests.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {profile.interests.slice(0, 5).map((i) => (
                  <span key={i.label} className={cn("glass-chip rounded-full px-2.5 py-1 text-[11px] font-medium text-white", i.shared && "border-rose-300/40 bg-rose-500/25")}>
                    {i.shared && <Sparkles className="mr-1 inline size-3 text-rose-200" aria-hidden="true" />}
                    {i.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        </motion.div>

        {/* Floating actions */}
        <div className="safe-bottom flex items-center justify-center gap-4 pb-2 pt-4">
          <motion.div whileTap={{ scale: 0.85 }}>
            <Button variant="outline" size="icon" aria-label="Undo last swipe" className="size-12 rounded-full" onClick={undo}>
              <RotateCcw className="size-5 text-warning" />
            </Button>
          </motion.div>
          <motion.div whileTap={{ scale: 0.85 }}>
            <Button variant="outline" size="icon" aria-label="Pass" className="size-16 rounded-full border-white/16" disabled={busy} onClick={() => decide("PASS")}>
              <X className="size-7 text-muted-foreground" />
            </Button>
          </motion.div>
          <motion.div whileTap={{ scale: 0.85 }}>
            <Button size="icon" aria-label="Like" className="size-16 rounded-full shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_0_28px_rgba(225,29,72,0.45)]" disabled={busy} onClick={() => decide("LIKE")}>
              <Heart className="size-7 fill-current" />
            </Button>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}
