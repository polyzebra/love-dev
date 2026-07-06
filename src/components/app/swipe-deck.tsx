"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionTemplate,
  useMotionValue,
  useTransform,
} from "motion/react";
import { toast } from "sonner";
import { BadgeCheck, Heart, MapPin, RotateCcw, SearchX, Sparkles, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { MatchRing } from "@/components/shared/match-ring";
import { HeartBurst } from "@/components/fx/heart-burst";
import { emitInteraction } from "@/lib/interaction-events";
import { useDominantColor, type RGB } from "@/hooks/use-dominant-color";
import type { DiscoverProfile } from "@/lib/services/discovery";
import { cn, formatDistance } from "@/lib/utils";

type SwipeAction = "LIKE" | "PASS" | "SUPER_LIKE";

export type ViewerContext = {
  city: string | null;
  interests: string[];
};

/** Honest, data-backed reasons this profile appears - never invented. */
function compatibilityReasons(
  profile: DiscoverProfile,
  viewer: ViewerContext | null,
  shared: string[],
): string[] {
  const reasons: string[] = [];
  if (shared.length === 1) reasons.push(`You both love ${shared[0].toLowerCase()}`);
  if (shared.length > 1) reasons.push(`${shared.length} shared interests`);
  if (viewer?.city && profile.city && viewer.city === profile.city)
    reasons.push(`Both in ${profile.city}`);
  else if (profile.distanceKm != null && profile.distanceKm <= 15)
    reasons.push("Practically neighbours");
  if (profile.isVerified) reasons.push("Photo verified");
  if (profile.isOnline) reasons.push("Online right now");
  return reasons.slice(0, 3);
}

const EXIT_VELOCITY = 600;
const EXIT_OFFSET = 110;

function photoGradient(seed: string): string {
  const hues = [346, 12, 262, 200, 160];
  const h = hues[seed.charCodeAt(0) % hues.length];
  return `linear-gradient(160deg, hsl(${h} 80% 72%) 0%, hsl(${h} 72% 48%) 55%, hsl(${h} 70% 26%) 100%)`;
}

/**
 * The card is a physical object: it lifts as you grab it, bends into
 * the direction of travel (rotateY), banks with drag (rotateZ), and a
 * light source follows your pointer across the surface. Releases fly
 * out on the gesture's own velocity.
 */
function TopCard({
  profile,
  reasons,
  sharedSet,
  onDecide,
  registerDecider,
}: {
  profile: DiscoverProfile;
  reasons: string[];
  sharedSet: Set<string>;
  onDecide: (action: SwipeAction) => void;
  registerDecider: (fn: (action: SwipeAction) => void) => void;
}) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-260, 260], [-13, 13]);
  const bend = useTransform(x, [-260, 260], [7, -7]); // subtle 3D fold
  const likeOpacity = useTransform(x, [40, 130], [0, 1]);
  const passOpacity = useTransform(x, [-130, -40], [1, 0]);

  // Pointer-tracked lighting
  const lx = useMotionValue(50);
  const ly = useMotionValue(35);
  const light = useMotionTemplate`radial-gradient(26rem 26rem at ${lx}% ${ly}%, rgba(255,255,255,0.09), transparent 60%)`;

  const [grabbed, setGrabbed] = useState(false);
  const [photoLoaded, setPhotoLoaded] = useState(false);
  const leaving = useRef(false);
  const photo = profile.photos[0];

  const flyOut = useCallback(
    (action: SwipeAction, velocity = 0) => {
      if (leaving.current) return;
      leaving.current = true;
      const dir = action === "PASS" ? -1 : 1;
      const targetX = dir * (typeof window !== "undefined" ? window.innerWidth : 600) * 1.1;
      const speed = Math.max(Math.abs(velocity), 900);
      animate(x, targetX, {
        type: "spring",
        stiffness: 90,
        damping: 16,
        velocity: dir * speed,
      });
      animate(y, action === "SUPER_LIKE" ? -80 : 40, { duration: 0.4 });
      // Hand off to the deck slightly before the spring settles
      window.setTimeout(() => onDecide(action), 240);
    },
    [onDecide, x, y],
  );

  // Let the action bar drive the same physics as a gesture
  useEffect(() => {
    registerDecider(flyOut);
  }, [registerDecider, flyOut]);

  return (
    <motion.article
      aria-label={`${profile.displayName}, ${profile.age}`}
      className="absolute inset-0 cursor-grab touch-none select-none [perspective:1000px] active:cursor-grabbing"
      style={{ x, y, rotate }}
      drag
      dragElastic={0.85}
      dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
      onDragStart={() => setGrabbed(true)}
      onDragEnd={(_, info) => {
        setGrabbed(false);
        const { offset, velocity } = info;
        if (offset.x > EXIT_OFFSET || velocity.x > EXIT_VELOCITY) flyOut("LIKE", velocity.x);
        else if (offset.x < -EXIT_OFFSET || velocity.x < -EXIT_VELOCITY) flyOut("PASS", velocity.x);
      }}
      onPointerMove={(e) => {
        if (e.pointerType !== "mouse") return;
        const rect = e.currentTarget.getBoundingClientRect();
        lx.set(((e.clientX - rect.left) / rect.width) * 100);
        ly.set(((e.clientY - rect.top) / rect.height) * 100);
      }}
      initial={{ scale: 0.94, y: 14, opacity: 0.7 }}
      animate={{
        scale: grabbed ? 1.035 : 1,
        y: 0,
        opacity: 1,
        boxShadow: grabbed
          ? "0 40px 90px rgba(0,0,0,0.65), 0 0 40px rgba(225,29,72,0.18)"
          : "0 24px 60px rgba(0,0,0,0.5)",
      }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ type: "spring", stiffness: 320, damping: 26 }}
    >
      <motion.div
        style={{ rotateY: bend }}
        className="relative flex h-full w-full flex-col justify-end overflow-hidden rounded-[30px] border border-white/12"
      >
        {/* Photo */}
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo.url}
            alt=""
            onLoad={() => setPhotoLoaded(true)}
            className={cn(
              "absolute inset-0 h-full w-full object-cover transition-[opacity,filter] duration-700 ease-out",
              photoLoaded ? "opacity-100 blur-0" : "opacity-0 blur-md",
            )}
            draggable={false}
          />
        ) : (
          <div className="absolute inset-0" style={{ background: photoGradient(profile.userId) }} />
        )}
        {/* Cinematic grade + inner edge light */}
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
        <div className="absolute inset-0 rounded-[30px] shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]" />
        {/* Pointer lighting */}
        <motion.div aria-hidden="true" className="absolute inset-0" style={{ background: light }} />

        {/* Verdict stamps */}
        <motion.span
          style={{ opacity: likeOpacity }}
          className="absolute left-6 top-9 -rotate-12 rounded-2xl border-4 border-emerald-400 px-4 py-1 text-2xl font-extrabold uppercase tracking-widest text-emerald-400"
          aria-hidden="true"
        >
          Like
        </motion.span>
        <motion.span
          style={{ opacity: passOpacity }}
          className="absolute right-6 top-9 rotate-12 rounded-2xl border-4 border-white/85 px-4 py-1 text-2xl font-extrabold uppercase tracking-widest text-white/85"
          aria-hidden="true"
        >
          Pass
        </motion.span>

        {/* Floating badges + the WHY behind the number */}
        <div className="absolute inset-x-4 top-4 flex items-start justify-between">
          <div className="flex flex-col items-start gap-1.5">
            <MatchRing value={profile.compatibility} />
            <motion.ul
              initial="hidden"
              animate="show"
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.35, delayChildren: 0.7 } } }}
              className="space-y-1"
              aria-label="Why you match"
            >
              {reasons.map((reason) => (
                <motion.li
                  key={reason}
                  variants={{
                    hidden: { opacity: 0, x: -12 },
                    show: { opacity: 1, x: 0, transition: { type: "spring", stiffness: 300, damping: 26 } },
                  }}
                  className="glass-chip w-fit rounded-full px-2.5 py-0.5 text-[10px] font-medium text-white/90"
                >
                  {reason}
                </motion.li>
              ))}
            </motion.ul>
          </div>
          {profile.isOnline && (
            <span className="glass-chip flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium text-white">
              <span className="relative flex size-2" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping-soft rounded-full bg-emerald-400" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
              </span>
              Online
            </span>
          )}
        </div>

        {/* Identity */}
        <div className="relative space-y-2.5 p-6">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-3xl font-semibold tracking-tight text-white">
              {profile.displayName}, {profile.age}
            </h2>
            {profile.isVerified && (
              <span role="img" className="relative flex items-center justify-center" aria-label="Photo verified">
                <span className="absolute size-6 animate-ping-soft rounded-full bg-sky-400/30" />
                <BadgeCheck className="relative size-6 fill-sky-400 text-white" />
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/85">
            {profile.city && (
              <span className="flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden="true" />
                {profile.city}
              </span>
            )}
            {profile.distanceKm != null && <span>{formatDistance(profile.distanceKm)}</span>}
          </div>
          {profile.bio && (
            <p className="line-clamp-2 text-sm/relaxed text-white/90">{profile.bio}</p>
          )}
          {profile.interests.length > 0 && (
            <motion.div
              className="flex flex-wrap gap-1.5 pt-1"
              initial="hidden"
              animate="show"
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06, delayChildren: 0.35 } } }}
            >
              {[...profile.interests]
                .sort((a, b) => Number(sharedSet.has(b)) - Number(sharedSet.has(a)))
                .slice(0, 4)
                .map((interest) => {
                  const shared = sharedSet.has(interest);
                  return (
                    <motion.span
                      key={interest}
                      variants={{
                        hidden: { opacity: 0, y: 10, scale: 0.9 },
                        show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 380, damping: 24 } },
                      }}
                      className={cn(
                        "flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium",
                        shared
                          ? "border border-rose-300/40 bg-rose-500/30 text-white shadow-[0_0_14px_rgba(225,29,72,0.35)] backdrop-blur-md"
                          : "glass-chip text-white",
                      )}
                    >
                      {shared && <Sparkles className="size-3 text-rose-200" aria-hidden="true" />}
                      {interest}
                    </motion.span>
                  );
                })}
            </motion.div>
          )}
        </div>
      </motion.div>
    </motion.article>
  );
}

export function SwipeDeck({
  initialProfiles,
  viewer,
}: {
  initialProfiles: DiscoverProfile[];
  viewer: ViewerContext | null;
}) {
  const [deck, setDeck] = useState(initialProfiles);
  const [matchedWith, setMatchedWith] = useState<DiscoverProfile | null>(null);
  const busy = useRef(false);
  const deciderRef = useRef<((action: SwipeAction) => void) | null>(null);

  const top = deck[0];
  const next = deck[1];

  // Shared ground with the person on top - drives reasons & highlights
  const viewerSet = new Set(viewer?.interests ?? []);
  const shared = top ? top.interests.filter((i) => viewerSet.has(i)) : [];
  const sharedSet = new Set(shared);
  const reasons = top ? compatibilityReasons(top, viewer, shared) : [];

  // Ambient light sampled from the top card's photo; falls back to brand rose
  const dominant = useDominantColor(top?.photos[0]?.url);
  const ambient: RGB = dominant ?? [225, 29, 72];

  const commit = useCallback(
    async (action: SwipeAction) => {
      const current = deck[0];
      if (!current || busy.current) return;
      busy.current = true;
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
        emitInteraction(
          action === "LIKE" ? "like" : action === "PASS" ? "pass" : "superlike",
        );
        if (data.matched) {
          emitInteraction("match");
          setMatchedWith(current);
        }
      } catch {
        setDeck((d) => [current, ...d]);
        toast.error("You appear to be offline.");
      } finally {
        busy.current = false;
      }
    },
    [deck],
  );

  const act = useCallback((action: SwipeAction) => {
    // Route through the top card so buttons get the same exit physics
    if (deciderRef.current) deciderRef.current(action);
  }, []);

  const undo = useCallback(async () => {
    const res = await fetch("/api/swipes", { method: "DELETE" });
    if (res.status === 402) {
      toast("Undo is a Plus feature.", {
        action: { label: "Upgrade", onClick: () => (window.location.href = "/pricing") },
      });
      return;
    }
    if (res.ok) {
      emitInteraction("undo");
      toast.success("Last swipe undone. Refresh to see them again.");
    } else toast("Nothing to undo yet.");
  }, []);

  if (deck.length === 0) {
    return (
      <EmptyState
        icon={SearchX}
        title="You're all caught up"
        description="No more profiles match your filters right now. Widen your distance or age range, or check back later - new members join every day."
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
        {/* Ambient stage light - tinted by the person's photo */}
        <div
          aria-hidden="true"
          className="absolute left-1/2 top-1/2 size-80 -translate-x-1/2 -translate-y-1/2 rounded-full blur-2xl transition-[background] duration-[1400ms] ease-out"
          style={{
            background: `radial-gradient(closest-side, rgba(${ambient[0]},${ambient[1]},${ambient[2]},0.22), transparent 70%)`,
          }}
        />

        {/* Next card preview - real content, waiting underneath */}
        {next && (
          <motion.div
            key={`peek-${next.userId}`}
            aria-hidden="true"
            initial={{ scale: 0.9, y: 24, opacity: 0.4 }}
            animate={{ scale: 0.94, y: 14, opacity: 0.75 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            className="absolute inset-0 overflow-hidden rounded-[30px] border border-white/8 bg-card shadow-card"
          >
            {next.photos[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={next.photos[0].url} alt="" className="h-full w-full object-cover opacity-70" />
            ) : (
              <div className="h-full w-full" style={{ background: photoGradient(next.userId) }} />
            )}
            <div className="absolute inset-0 bg-black/35" />
          </motion.div>
        )}

        <AnimatePresence>
          {top && (
            <TopCard
              key={top.userId}
              profile={top}
              reasons={reasons}
              sharedSet={sharedSet}
              onDecide={commit}
              registerDecider={(fn) => (deciderRef.current = fn)}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Action bar */}
      <div className="mt-7 flex items-center justify-center gap-4">
        <motion.div whileTap={{ scale: 0.85 }}>
          <Button
            variant="outline"
            size="icon"
            aria-label="Undo last swipe"
            className="size-12 rounded-full"
            onClick={undo}
          >
            <RotateCcw className="size-5 text-warning" />
          </Button>
        </motion.div>
        <motion.div whileTap={{ scale: 0.85 }} whileHover={{ scale: 1.06 }}>
          <Button
            variant="outline"
            size="icon"
            aria-label="Pass"
            className="size-16 rounded-full border-white/16"
            onClick={() => act("PASS")}
          >
            <X className="size-7 text-muted-foreground" />
          </Button>
        </motion.div>
        <motion.div whileTap={{ scale: 0.85 }} whileHover={{ scale: 1.08 }}>
          <Button
            size="icon"
            aria-label="Like"
            className="size-16 rounded-full shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_0_28px_rgba(225,29,72,0.45),0_12px_32px_rgba(225,29,72,0.3)]"
            onClick={() => act("LIKE")}
          >
            <Heart className="size-7 fill-current" />
          </Button>
        </motion.div>
        <motion.div whileTap={{ scale: 0.85 }} whileHover={{ scale: 1.06 }}>
          <Button
            variant="outline"
            size="icon"
            aria-label="Super Like"
            className="size-12 rounded-full"
            onClick={() => act("SUPER_LIKE")}
          >
            <Star className="size-5 fill-sky-400 text-sky-400" />
          </Button>
        </motion.div>
      </div>

      {/* Match celebration */}
      <Dialog open={!!matchedWith} onOpenChange={(open) => !open && setMatchedWith(null)}>
        <DialogContent className="overflow-hidden rounded-[32px] border-white/10 text-center sm:max-w-sm">
          {matchedWith && <HeartBurst />}
          <DialogHeader className="relative items-center space-y-3">
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 320, damping: 14, delay: 0.1 }}
              className="flex size-16 items-center justify-center rounded-full bg-accent shadow-[0_0_40px_rgba(225,29,72,0.35)]"
            >
              <Heart className="size-8 fill-primary text-primary" aria-hidden="true" />
            </motion.span>
            <DialogTitle className="font-display text-3xl font-medium">It&apos;s a match</DialogTitle>
            <DialogDescription>
              You and {matchedWith?.displayName} liked each other. Break the ice while it&apos;s warm.
            </DialogDescription>
          </DialogHeader>
          <div className="relative grid gap-2">
            <Button className="h-12 rounded-full" asChild>
              <Link href="/chat">Say hello</Link>
            </Button>
            <Button variant="ghost" className="rounded-full" onClick={() => setMatchedWith(null)}>
              Keep swiping
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
