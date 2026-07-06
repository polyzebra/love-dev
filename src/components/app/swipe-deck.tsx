"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useMotionValue, useTransform } from "motion/react";
import { toast } from "sonner";
import {
  BadgeCheck,
  Heart,
  MapPin,
  RotateCcw,
  SearchX,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/empty-state";
import type { DiscoverProfile } from "@/lib/services/discovery";
import { cn, formatDistance } from "@/lib/utils";

type SwipeAction = "LIKE" | "PASS" | "SUPER_LIKE";

function photoGradient(seed: string): string {
  const hues = [346, 12, 262, 200, 160];
  const h = hues[seed.charCodeAt(0) % hues.length];
  return `linear-gradient(160deg, hsl(${h} 80% 72%) 0%, hsl(${h} 72% 48%) 55%, hsl(${h} 70% 26%) 100%)`;
}

function TopCard({
  profile,
  onSwipe,
}: {
  profile: DiscoverProfile;
  onSwipe: (action: SwipeAction) => void;
}) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-250, 250], [-14, 14]);
  const likeOpacity = useTransform(x, [40, 140], [0, 1]);
  const passOpacity = useTransform(x, [-140, -40], [1, 0]);
  const photo = profile.photos[0];

  return (
    <motion.article
      aria-label={`${profile.displayName}, ${profile.age}`}
      className="absolute inset-0 cursor-grab touch-none select-none active:cursor-grabbing"
      style={{ x, rotate }}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.9}
      onDragEnd={(_, info) => {
        if (info.offset.x > 110 || info.velocity.x > 600) onSwipe("LIKE");
        else if (info.offset.x < -110 || info.velocity.x < -600) onSwipe("PASS");
      }}
      initial={{ scale: 0.97, opacity: 0.8 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.18 } }}
      transition={{ type: "spring", stiffness: 350, damping: 30 }}
    >
      <div className="relative flex h-full w-full flex-col justify-end overflow-hidden rounded-[28px] border border-white/12 shadow-float [box-shadow:inset_0_1px_0_rgba(255,255,255,0.14),0_12px_40px_rgba(0,0,0,0.5),0_32px_80px_rgba(0,0,0,0.35)]">
        {/* Photo layer */}
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo.url}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="absolute inset-0" style={{ background: photoGradient(profile.userId) }} />
        )}
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />

        {/* Swipe verdict stamps */}
        <motion.span
          style={{ opacity: likeOpacity }}
          className="absolute left-6 top-8 -rotate-12 rounded-xl border-4 border-success px-4 py-1 text-2xl font-extrabold uppercase tracking-widest text-success"
          aria-hidden="true"
        >
          Like
        </motion.span>
        <motion.span
          style={{ opacity: passOpacity }}
          className="absolute right-6 top-8 rotate-12 rounded-xl border-4 border-white/90 px-4 py-1 text-2xl font-extrabold uppercase tracking-widest text-white/90"
          aria-hidden="true"
        >
          Pass
        </motion.span>

        {/* Profile info */}
        <div className="relative space-y-2.5 p-6 text-white">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-3xl font-semibold tracking-tight">
              {profile.displayName}, {profile.age}
            </h2>
            {profile.isVerified && (
              <BadgeCheck className="size-6 fill-sky-400 text-white" aria-label="Photo verified" />
            )}
            {profile.isOnline && (
              <span className="glass-chip flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium">
                <span className="relative flex size-1.5" aria-hidden="true">
                  <span className="absolute inline-flex h-full w-full animate-ping-soft rounded-full bg-emerald-400" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
                </span>
                Online
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-sm text-white/85">
            {profile.city && (
              <span className="flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden="true" />
                {profile.city}
              </span>
            )}
            {profile.distanceKm != null && <span>{formatDistance(profile.distanceKm)}</span>}
            <span className="flex items-center gap-1">
              <Sparkles className="size-3.5" aria-hidden="true" />
              {profile.compatibility}% match
            </span>
          </div>
          {profile.bio && <p className="line-clamp-2 text-sm/relaxed text-white/90">{profile.bio}</p>}
          {profile.interests.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {profile.interests.slice(0, 4).map((interest) => (
                <span
                  key={interest}
                  className="glass-chip rounded-full px-3 py-1 text-xs font-medium"
                >
                  {interest}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.article>
  );
}

export function SwipeDeck({ initialProfiles }: { initialProfiles: DiscoverProfile[] }) {
  const [deck, setDeck] = useState(initialProfiles);
  const [matchedWith, setMatchedWith] = useState<DiscoverProfile | null>(null);
  const [busy, setBusy] = useState(false);

  const top = deck[0];
  const next = deck[1];

  const swipe = useCallback(
    async (action: SwipeAction) => {
      if (!top || busy) return;
      setBusy(true);
      const current = top;
      setDeck((d) => d.slice(1));

      try {
        const res = await fetch("/api/swipes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toId: current.userId, action }),
        });
        if (res.status === 402) {
          const payload = await res.json().catch(() => null);
          toast(payload?.error?.message ?? "Daily limit reached.", {
            action: { label: "Upgrade", onClick: () => (window.location.href = "/pricing") },
          });
          setDeck((d) => [current, ...d]);
          return;
        }
        if (!res.ok) {
          setDeck((d) => [current, ...d]);
          toast.error("Something went wrong. Try again.");
          return;
        }
        const { data } = (await res.json()) as { data: { matched: boolean } };
        if (data.matched) setMatchedWith(current);
      } catch {
        setDeck((d) => [current, ...d]);
        toast.error("You appear to be offline.");
      } finally {
        setBusy(false);
      }
    },
    [top, busy],
  );

  const undo = useCallback(async () => {
    const res = await fetch("/api/swipes", { method: "DELETE" });
    if (res.status === 402) {
      toast("Undo is a Plus feature.", {
        action: { label: "Upgrade", onClick: () => (window.location.href = "/pricing") },
      });
      return;
    }
    if (res.ok) {
      toast.success("Last swipe undone. Refresh to see them again.");
    } else {
      toast("Nothing to undo yet.");
    }
  }, []);

  if (deck.length === 0) {
    return (
      <EmptyState
        icon={SearchX}
        title="You're all caught up"
        description="No more profiles match your filters right now. Widen your distance or age range, or check back later — new members join every day."
        action={
          <Button className="rounded-full" asChild>
            <Link href="/settings/discovery">Adjust filters</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="relative aspect-3/4 w-full" role="group" aria-label="Profile cards">
        {/* Ambient glow beneath the deck */}
        <div
          aria-hidden="true"
          className="absolute left-1/2 top-1/2 size-[24rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(225,29,72,0.2),transparent_70%)] blur-2xl"
        />
        {/* Next card peeking behind */}
        {next && (
          <div
            className="absolute inset-0 scale-[0.94] translate-y-3 rounded-[28px] border border-white/8 bg-card shadow-card"
            aria-hidden="true"
          />
        )}
        <AnimatePresence>
          {top && <TopCard key={top.userId} profile={top} onSwipe={swipe} />}
        </AnimatePresence>
      </div>

      {/* Action bar */}
      <div className="mt-6 flex items-center justify-center gap-4">
        <Button
          variant="outline"
          size="icon"
          aria-label="Undo last swipe"
          className="size-12 rounded-full"
          onClick={undo}
        >
          <RotateCcw className="size-5 text-warning" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Pass"
          className="size-16 rounded-full border-2"
          disabled={busy}
          onClick={() => swipe("PASS")}
        >
          <X className="size-7 text-muted-foreground" />
        </Button>
        <Button
          size="icon"
          aria-label="Like"
          className="size-16 rounded-full shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_0_28px_rgba(225,29,72,0.45),0_12px_32px_rgba(225,29,72,0.3)]"
          disabled={busy}
          onClick={() => swipe("LIKE")}
        >
          <Heart className="size-7 fill-current" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Super Like"
          className="size-12 rounded-full"
          disabled={busy}
          onClick={() => swipe("SUPER_LIKE")}
        >
          <Star className="size-5 fill-sky-400 text-sky-400" />
        </Button>
      </div>

      {/* Match celebration */}
      <Dialog open={!!matchedWith} onOpenChange={(open) => !open && setMatchedWith(null)}>
        <DialogContent className="rounded-3xl text-center sm:max-w-sm">
          <DialogHeader className="items-center space-y-3">
            <span
              className={cn(
                "flex size-16 animate-heart-pop items-center justify-center rounded-full bg-accent",
              )}
            >
              <Heart className="size-8 fill-primary text-primary" aria-hidden="true" />
            </span>
            <DialogTitle className="font-display text-2xl">It&apos;s a match!</DialogTitle>
            <DialogDescription>
              You and {matchedWith?.displayName} liked each other. Break the ice while it&apos;s
              warm.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Button className="h-12 rounded-2xl" asChild>
              <Link href="/chat">Say hello</Link>
            </Button>
            <Button variant="ghost" className="rounded-2xl" onClick={() => setMatchedWith(null)}>
              Keep swiping
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
