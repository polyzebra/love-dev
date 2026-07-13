"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react";
import { toast } from "sonner";
import {
  ArrowLeft,
  BadgeCheck,
  Bell,
  Heart,
  MapPin,
  MessageCircle,
  RotateCcw,
  SearchX,
  SlidersHorizontal,
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
import { FirstMessageSheet, type FirstMessageResult } from "@/components/app/first-message-sheet";
import { PhotoFrame } from "@/components/shared/photo-frame";
import { HeartBurst } from "@/components/fx/heart-burst";
import { emitInteraction } from "@/lib/interaction-events";
import { SPRING, softSpring } from "@/lib/motion";
import { useDominantColor, type RGB } from "@/hooks/use-dominant-color";
import type { DiscoverProfile } from "@/lib/services/discovery";
import type { RelationshipGoal } from "@/generated/prisma/enums";
import { byId, pickTemplate, type TaxonomyCategory } from "@/lib/discovery/taxonomy";
import { messageFromTemplate } from "@/lib/assistant";
import { cn, formatDistance } from "@/lib/utils";

type SwipeAction = "LIKE" | "PASS" | "SUPER_LIKE";

export type ViewerContext = {
  /** Viewer's user id - seeds deterministic per-pair opener templates. */
  id?: string | null;
  city: string | null;
  interests: string[];
  goal: RelationshipGoal | null;
};

type Story = { kind: "reason"; text: string } | { kind: "prompt"; label: string; answer: string };

/** Trust facts live in the trust row - never repeat them as the story line. */
const NON_STORY_REASONS = new Set([
  "Photo verified",
  "Online right now",
  "New this week",
  "Same relationship goal",
]);

/**
 * ONE human line for the card face: the server's taxonomy-driven reason
 * first, then the person's own prompt answer. Never invented - every
 * branch traces to real data.
 */
function storyFor(profile: DiscoverProfile): Story | null {
  const human = profile.reasons.find((r) => !NON_STORY_REASONS.has(r));
  if (human) return { kind: "reason", text: human };
  if (profile.promptTease) return { kind: "prompt", ...profile.promptTease };
  return null;
}

/** "A typical Saturday" -> "a typical Saturday" for mid-sentence use. */
function lowerLabel(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** Taxonomy categories the pair shares, as resolved category objects. */
function sharedCategories(profile: DiscoverProfile): TaxonomyCategory[] {
  return profile.sharedCategoryIds
    .map((id) => byId.get(id))
    .filter((c): c is TaxonomyCategory => c != null);
}

/**
 * Up to 3 REAL overlaps for the match dialog, in taxonomy language:
 * the shared relationship-goal category first, then a shared lifestyle
 * or right-now category, then a shared interest category. Never invented.
 */
function sharedContextChips(profile: DiscoverProfile): string[] {
  const shared = sharedCategories(profile);
  const first = (...groups: TaxonomyCategory["group"][]) =>
    shared.find((c) => groups.includes(c.group)) ?? null;
  return [first("relationship"), first("lifestyle", "right-now"), first("interests")]
    .filter((c): c is TaxonomyCategory => c != null)
    .map((c) => pickTemplate(c.matchReasonTemplates, `${profile.userId}:${c.id}`))
    .slice(0, 3);
}

/**
 * Suggested first message from the strongest shared category's chat
 * prompt templates - the CTA label is the coach-voice template, the
 * prefilled composer text its ready-to-send form.
 */
function suggestedOpener(profile: DiscoverProfile): { label: string; send: string } | null {
  const strongest = sharedCategories(profile)[0]; // server sorts by weight
  if (!strongest) return null;
  const template = pickTemplate(strongest.chatPromptTemplates, `${profile.userId}:${strongest.id}`);
  if (!template) return null;
  return { label: template.replace(/\.$/, ""), send: messageFromTemplate(template) };
}

const EXIT_VELOCITY = 600;
const EXIT_OFFSET = 110;

/* Sits ON the photo - theme-independent material, do not tokenize */
const TRUST_CHIP_CLASS =
  "flex items-center gap-1 rounded-full border border-white/15 bg-white/10 backdrop-blur-md px-2.5 py-0.5 text-[10px] font-medium text-white/80";
const TRUST_CHIP_VARIANTS = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: SPRING.snappy },
};

/* Photo-column geometry: width derives from height (portrait ~3/4) */
const STAGE_COLUMN_WIDTH =
  "md:w-[min(100%,calc((100dvh-1.5rem)*0.78))] lg:w-[min(100%,calc((100dvh-2rem)*0.78))]";
/* Edge-to-edge on mobile; rounded inside the ambient field on md+ */
const STAGE_RADIUS = "rounded-lg md:rounded-xl lg:rounded-2xl";
/* Action row floats over the photo, clear of the mobile nav capsule */
const ACTION_ROW_BOTTOM =
  "bottom-[calc(max(1rem,var(--safe-bottom))+4.75rem)] lg:bottom-[calc(var(--safe-bottom)+2rem)]";
/* Circle controls that sit ON the photo - theme-independent material */
const PHOTO_GLASS_BUTTON =
  "pointer-events-auto flex items-center justify-center rounded-full border border-white/15 bg-white/10 text-white backdrop-blur-xl transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60";

function photoGradient(seed: string): string {
  const hues = [346, 12, 262, 200, 160];
  const h = hues[seed.charCodeAt(0) % hues.length];
  return `linear-gradient(160deg, hsl(${h} 80% 72%) 0%, hsl(${h} 72% 48%) 55%, hsl(${h} 70% 26%) 100%)`;
}

/**
 * Full-viewport ambient field behind the photo column: a blurred,
 * darkened duplicate of the current photo crossfades underneath, tied
 * to the theme with a background veil and warmed by the dominant tone.
 * Guarantees the space beside/behind the card never reads as bare page.
 */
function AmbientBackdrop({ url, tint }: { url: string | null; tint: RGB }) {
  return (
    <div aria-hidden="true" className="bg-background absolute inset-0 overflow-hidden">
      <AnimatePresence initial={false}>
        {url && (
          <motion.img
            key={url}
            src={url}
            alt=""
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9, ease: "easeOut" }}
            className="absolute inset-0 h-full w-full scale-125 object-cover blur-[64px] saturate-[1.2] select-none [-webkit-touch-callout:none] [-webkit-user-drag:none]"
            draggable={false}
            onContextMenu={(e) => e.preventDefault()}
          />
        )}
      </AnimatePresence>
      {/* Theme veil - keeps the field cinematic in dark, airy in light */}
      <div className="bg-background/55 absolute inset-0" />
      {/* Dominant-tone wash sampled from the person's photo */}
      <div
        className="absolute inset-0 transition-[background] duration-[1200ms] ease-out"
        style={{
          background: `radial-gradient(90% 70% at 50% 32%, rgba(${tint[0]},${tint[1]},${tint[2]},0.2), transparent 70%)`,
        }}
      />
      {/* Soft vignette pulls focus to the column */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_50%,transparent_45%,rgba(0,0,0,0.28)_100%)]" />
    </div>
  );
}

/**
 * The card is a physical object: it lifts as you grab it, bends into
 * the direction of travel (rotateY), banks with drag (rotateZ), and a
 * light source follows your pointer across the surface. Releases fly
 * out on the gesture's own velocity.
 */
function TopCard({
  profile,
  story,
  photoIndex,
  onCyclePhoto,
  indentIndicators,
  onDecide,
  registerDecider,
}: {
  profile: DiscoverProfile;
  story: Story | null;
  photoIndex: number;
  onCyclePhoto: (dir: 1 | -1) => void;
  indentIndicators: boolean;
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
  // MotionConfig reducedMotion="user" only gates motion COMPONENTS - the
  // standalone animate() calls below must self-gate (see lib/motion.ts).
  const reducedMotion = useReducedMotion();
  const leaving = useRef(false);
  const suppressTap = useRef(false); // a drag must never read as a photo tap
  const photos = profile.photos;
  const photo = photos[photoIndex] ?? photos[0];

  const flyOut = useCallback(
    (action: SwipeAction, velocity = 0) => {
      if (leaving.current) return;
      leaving.current = true;
      // Reduced motion: no spatial fly-out - the AnimatePresence exit fade
      // (opacity-only) is the whole departure. The decision is identical.
      if (reducedMotion) {
        onDecide(action);
        return;
      }
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
    [onDecide, x, y, reducedMotion],
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
      onDragStart={() => {
        setGrabbed(true);
        suppressTap.current = true;
      }}
      onDragEnd={(_, info) => {
        setGrabbed(false);
        window.setTimeout(() => (suppressTap.current = false), 120);
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
      initial={{ scale: 0.96, opacity: 0.7 }}
      animate={{ scale: grabbed ? 1.02 : 1, opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ type: "spring", stiffness: 320, damping: 26 }}
    >
      <motion.div
        style={{ rotateY: bend }}
        // Shadow lives on the ROUNDED, 3D-bent card itself - on the square
        // outer drag wrapper it painted a rotating rectangular rim
        animate={{
          boxShadow: grabbed
            ? "0 40px 90px rgba(0,0,0,0.65), 0 0 40px rgba(225,29,72,0.18)"
            : "0 24px 60px rgba(0,0,0,0.5)",
        }}
        transition={{ type: "spring", stiffness: 320, damping: 26 }}
        className={cn(
          // Opaque base fill: while the photo streams in, the card must be
          // one clean dark surface - transparent here let the ambient
          // backdrop + pointer light read as a pale inset frame on reload
          "relative flex h-full w-full flex-col justify-end overflow-hidden bg-[#0f0e11]",
          STAGE_RADIUS,
        )}
      >
        {/* Photo - fills the stage; the stage element owns rounding/clipping.
            variant="card": full.webp is reserved for the fullscreen viewer. */}
        <PhotoFrame
          mode="fill"
          variant="card"
          photo={photo ?? null}
          draggable={false}
          fallback={
            <div className="h-full w-full" style={{ background: photoGradient(profile.userId) }} />
          }
        />
        {/* Cinematic grade: top scrim for controls, deep bottom scrim for info */}
        <div className="absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-black/55 via-black/20 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-t from-black/90 via-black/35 to-transparent" />
        {/* Pointer lighting */}
        <motion.div aria-hidden="true" className="absolute inset-0" style={{ background: light }} />

        {/* Photo cycling: tap left/right halves (presentation-level only) */}
        {photos.length > 1 && (
          <div className="absolute inset-x-0 top-[calc(var(--safe-top)+4.5rem)] bottom-[45%] z-10 flex">
            <button
              type="button"
              aria-label="Previous photo"
              className="h-full w-1/2 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-inset"
              onClick={() => {
                if (!suppressTap.current) onCyclePhoto(-1);
              }}
            />
            <button
              type="button"
              aria-label="Next photo"
              className="h-full w-1/2 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-inset"
              onClick={() => {
                if (!suppressTap.current) onCyclePhoto(1);
              }}
            />
          </div>
        )}

        {/* Photo progress - thin segments, top-left of the stage */}
        {photos.length > 1 && (
          <div
            aria-hidden="true"
            className={cn(
              "absolute top-[calc(var(--safe-top)+2.25rem)] right-32 z-10 flex gap-1.5",
              indentIndicators ? "left-[4.5rem]" : "left-4",
            )}
          >
            {photos.map((p, i) => (
              <span
                key={p.url}
                className={cn(
                  "h-[3px] flex-1 rounded-full transition-colors duration-300",
                  i === photoIndex ? "bg-white/90" : "bg-white/30",
                )}
              />
            ))}
          </div>
        )}

        {/* Verdict stamps */}
        <motion.span
          style={{ opacity: likeOpacity }}
          className="absolute top-[calc(var(--safe-top)+7.5rem)] left-6 -rotate-12 rounded-2xl border-4 border-emerald-400 px-4 py-1 text-2xl font-extrabold tracking-widest text-emerald-400 uppercase"
          aria-hidden="true"
        >
          Like
        </motion.span>
        <motion.span
          style={{ opacity: passOpacity }}
          className="absolute top-[calc(var(--safe-top)+7.5rem)] right-6 rotate-12 rounded-2xl border-4 border-white/85 px-4 py-1 text-2xl font-extrabold tracking-widest text-white/85 uppercase"
          aria-hidden="true"
        >
          Pass
        </motion.span>

        {/* Compatibility, demoted: a quiet pill under the stage controls */}
        <div className="absolute top-[calc(var(--safe-top)+4.5rem)] right-4 z-10">
          <span
            role="img"
            // Sits over UNSCRIMMED photo: black-tinted glass so it stays
            // legible on bright photos (white/10 washed out against sky)
            className="flex items-center gap-1 rounded-full border border-white/20 bg-black/25 px-2.5 py-1 text-[11px] font-medium text-white/90 backdrop-blur-md"
            aria-label={`${profile.compatibility} percent match`}
          >
            <Heart className="size-3 fill-current text-rose-300/90" aria-hidden="true" />
            {profile.compatibility}%
          </span>
        </div>

        {/* Story-first identity, riding the bottom scrim - clears the action row */}
        <div className="relative z-10 space-y-2 px-5 pb-[calc(max(1rem,var(--safe-bottom))+10.5rem)] sm:px-6 lg:pb-[calc(var(--safe-bottom)+7.75rem)]">
          {/* Long-name stress: the NAME truncates, the age never disappears;
              the full name stays reachable via title. */}
          <h2
            className="font-display flex items-baseline text-4xl font-medium tracking-tight text-white [text-shadow:0_2px_24px_rgba(0,0,0,0.45)] sm:text-5xl"
            title={`${profile.displayName}, ${profile.age}`}
          >
            <span className="truncate">{profile.displayName}</span>
            <span className="shrink-0">{`, ${profile.age}`}</span>
          </h2>
          {profile.goalLine && (
            <p className="text-sm font-medium text-rose-200/95">{profile.goalLine}</p>
          )}
          {story &&
            (story.kind === "reason" ? (
              <p className="line-clamp-3 text-sm/relaxed text-white/90" title={story.text}>
                {story.text}
              </p>
            ) : (
              <p className="line-clamp-3 text-sm/relaxed text-white/90" title={story.answer}>
                <span className="italic">&ldquo;{story.answer}&rdquo;</span>
                <span className="text-white/65"> - {lowerLabel(story.label)}</span>
              </p>
            ))}

          {/* Trust row: quiet, real signals only */}
          {(profile.isVerified || profile.isOnline || profile.replySignal) && (
            <motion.div
              className="flex flex-wrap gap-1.5 pt-1"
              initial="hidden"
              animate="show"
              variants={{
                hidden: {},
                show: { transition: { staggerChildren: 0.08, delayChildren: 0.4 } },
              }}
            >
              {profile.isVerified && (
                <motion.span variants={TRUST_CHIP_VARIANTS} className={TRUST_CHIP_CLASS}>
                  <BadgeCheck className="size-3 text-sky-300" aria-hidden="true" />
                  Verified
                </motion.span>
              )}
              {profile.isOnline && (
                <motion.span variants={TRUST_CHIP_VARIANTS} className={TRUST_CHIP_CLASS}>
                  <span className="relative flex size-1.5" aria-hidden="true">
                    <span className="animate-ping-soft absolute inline-flex h-full w-full rounded-full bg-emerald-400" />
                    <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
                  </span>
                  Online now
                </motion.span>
              )}
              {profile.replySignal && (
                <motion.span variants={TRUST_CHIP_VARIANTS} className={TRUST_CHIP_CLASS}>
                  {profile.replySignal}
                </motion.span>
              )}
            </motion.div>
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/70">
            {profile.city && (
              <span className="flex items-center gap-1">
                <MapPin className="size-3" aria-hidden="true" />
                {profile.city}
              </span>
            )}
            {profile.distanceKm != null && <span>{formatDistance(profile.distanceKm)}</span>}
          </div>
        </div>
      </motion.div>
    </motion.article>
  );
}

export function SwipeDeck({
  initialProfiles,
  viewer,
  backHref = null,
}: {
  initialProfiles: DiscoverProfile[];
  viewer: ViewerContext | null;
  backHref?: string | null;
}) {
  const [deck, setDeck] = useState(initialProfiles);
  const [matchedWith, setMatchedWith] = useState<
    (DiscoverProfile & { conversationId?: string }) | null
  >(null);
  const busy = useRef(false);
  const deciderRef = useRef<((action: SwipeAction) => void) | null>(null);
  // First-message composer: who it's for, whether it's showing, and the
  // transient "Message sent" confirmation chip.
  const [composeFor, setComposeFor] = useState<DiscoverProfile | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [sentChip, setSentChip] = useState(false);
  // Set when the backend already created the Like (first message sent):
  // the next decide() advances the deck WITHOUT calling /api/swipes.
  const skipApi = useRef(false);

  const top = deck[0];
  const next = deck[1];

  // Photo cycling is presentation-only; reset when the top profile changes
  // (render-time reset on prop/state change - the React-sanctioned pattern).
  const [photoIndex, setPhotoIndex] = useState(0);
  const [prevTopId, setPrevTopId] = useState(top?.userId);
  if (top?.userId !== prevTopId) {
    setPrevTopId(top?.userId);
    setPhotoIndex(0);
  }
  const photoCount = top?.photos.length ?? 0;
  const safeIndex = photoCount > 0 ? Math.min(photoIndex, photoCount - 1) : 0;
  const currentPhoto = top?.photos[safeIndex] ?? null;
  const cyclePhoto = useCallback(
    (dir: 1 | -1) =>
      setPhotoIndex((i) => {
        const max = (deck[0]?.photos.length ?? 1) - 1;
        return Math.max(0, Math.min(max, i + dir));
      }),
    [deck],
  );

  // ONE human line for the card on top - real data only
  const story = top ? storyFor(top) : null;

  // Shared-context moment for the match dialog - only real taxonomy overlaps
  const matchChips = matchedWith ? sharedContextChips(matchedWith) : [];
  const opener = matchedWith ? suggestedOpener(matchedWith) : null;
  // Fallback CTA when no taxonomy category is shared but an interest is
  const firstSharedInterest =
    matchedWith && viewer
      ? (matchedWith.interests.find((i) => viewer.interests.includes(i)) ?? null)
      : null;

  // Ambient light sampled from the current photo; falls back to brand rose
  const dominant = useDominantColor(currentPhoto?.url);
  const ambient: RGB = dominant ?? [225, 29, 72];

  // Warm the NEXT profile's card image whenever the top card changes so the
  // peek-to-top promotion never streams in cold. `url` IS the card variant
  // (pickUrl: variant="card" -> photo.url) - full.webp is never touched here.
  useEffect(() => {
    const upcoming = next?.photos[0]?.url;
    if (!upcoming) return;
    const img = new Image();
    img.src = upcoming;
  }, [next]);

  const commit = useCallback(
    async (action: SwipeAction) => {
      const current = deck[0];
      if (!current || busy.current) return;
      if (skipApi.current) {
        // A first message already created the Like server-side - the
        // card got the same LIKE exit physics, we only advance locally.
        skipApi.current = false;
        setDeck((d) => d.slice(1));
        emitInteraction("like");
        return;
      }
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
        const { data } = (await res.json()) as {
          data: { matched: boolean; conversationId?: string };
        };
        emitInteraction(action === "LIKE" ? "like" : action === "PASS" ? "pass" : "superlike");
        if (data.matched) {
          emitInteraction("match");
          setMatchedWith({ ...current, conversationId: data.conversationId });
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

  // Desktop keyboard parity - no action is gesture-only. Left arrow =
  // pass, right arrow = like, U = undo (documented on the action buttons
  // via aria-keyshortcuts). Held keys never repeat-swipe, and dialogs,
  // sheets and form fields keep the keyboard to themselves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (composeOpen || matchedWith || !deck[0]) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        act("PASS");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        act("LIKE");
      } else if (e.key === "u" || e.key === "U") {
        e.preventDefault();
        void undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [act, undo, composeOpen, matchedWith, deck]);

  // ONE emotional line for the composer header - first human server
  // reason, else the goal line. Real data only, like the card itself.
  const composeReason = composeFor
    ? (composeFor.reasons.find((r) => !NON_STORY_REASONS.has(r)) ?? composeFor.goalLine)
    : null;

  /**
   * A first message landed (201): the backend already created the Like,
   * so confirm in-card, fly the card out with LIKE physics and advance
   * WITHOUT calling /api/swipes. A modal sheet covered the stage, so the
   * top card is still the person who was messaged.
   */
  const handleMessageSent = useCallback(
    (result: FirstMessageResult) => {
      const recipient = composeFor;
      setComposeOpen(false);
      setSentChip(true);
      window.setTimeout(() => setSentChip(false), 1200);
      // Let the chip land before the card leaves
      window.setTimeout(() => {
        skipApi.current = true;
        deciderRef.current?.("LIKE");
      }, 350);
      if (result.matched && recipient) {
        emitInteraction("match");
        setMatchedWith({ ...recipient, conversationId: result.conversationId });
      }
    },
    [composeFor],
  );

  // Stage chrome circles: photo material over a card, house glass otherwise
  const chromeCircle = cn(
    "pointer-events-auto flex size-11 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2",
    top
      ? "border border-white/15 bg-white/10 text-white backdrop-blur-xl hover:bg-white/20 focus-visible:ring-white/60"
      : "glass text-foreground hover:bg-foreground/10 focus-visible:ring-foreground/20",
  );

  return (
    <div className="fixed inset-0 z-30 overflow-hidden">
      {/* Full-viewport ambient field - never bare page behind the stage */}
      <AmbientBackdrop url={currentPhoto?.url ?? null} tint={ambient} />

      {/* Positioning field: clears the desktop rail, centers the column */}
      <div className="absolute inset-0 flex justify-center md:py-3 lg:left-72 lg:py-4">
        <div
          className={cn("relative h-full w-full", STAGE_COLUMN_WIDTH)}
          role="group"
          aria-label="Profile cards"
        >
          <p className="sr-only">
            Keyboard: press the right arrow to like, the left arrow to pass, and U to undo your last
            swipe.
          </p>
          {/* Next card peek - ~4% visible at the edges, waiting underneath */}
          {next && (
            <motion.div
              key={`peek-${next.userId}`}
              aria-hidden="true"
              initial={{ scale: 0.92, opacity: 0.3 }}
              animate={{ scale: 0.96, opacity: 0.7 }}
              transition={{ type: "spring", stiffness: 260, damping: 26 }}
              className={cn("absolute inset-0 overflow-hidden", STAGE_RADIUS)}
            >
              {next.photos[0] ? (
                <PhotoFrame
                  mode="fill"
                  variant="card"
                  photo={next.photos[0]}
                  className="opacity-60"
                />
              ) : (
                <div className="h-full w-full" style={{ background: photoGradient(next.userId) }} />
              )}
              <div className="absolute inset-0 bg-black/55" />
            </motion.div>
          )}

          <AnimatePresence>
            {top && (
              <TopCard
                key={top.userId}
                profile={top}
                story={story}
                photoIndex={safeIndex}
                onCyclePhoto={cyclePhoto}
                indentIndicators={!!backHref}
                onDecide={commit}
                registerDecider={(fn) => (deciderRef.current = fn)}
              />
            )}
          </AnimatePresence>

          {/* Out of profiles - full-stage, centered on the ambient field */}
          {!top && (
            <div className="flex h-full items-center justify-center pb-24 lg:pb-0">
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
            </div>
          )}

          {/* Stage chrome - floats over the photo, no bars or containers */}
          <div className="pointer-events-none absolute inset-0 z-20">
            {backHref && (
              <Link
                href={backHref}
                aria-label="Back to Explore"
                className={cn(chromeCircle, "absolute top-[calc(var(--safe-top)+1rem)] left-4")}
              >
                <ArrowLeft className="size-5" aria-hidden="true" />
              </Link>
            )}
            <div className="absolute top-[calc(var(--safe-top)+1rem)] right-4 flex gap-2">
              <Link href="/notifications" aria-label="Notifications" className={chromeCircle}>
                <Bell className="size-5" aria-hidden="true" />
              </Link>
              <Link
                href="/settings/discovery"
                aria-label="Discovery preferences"
                className={chromeCircle}
              >
                <SlidersHorizontal className="size-5" aria-hidden="true" />
              </Link>
            </div>

            {/* Action row - floats over the photo, above the nav dock */}
            {top && (
              <div
                className={cn(
                  "absolute inset-x-0 flex items-center justify-center gap-5 sm:gap-6",
                  ACTION_ROW_BOTTOM,
                )}
              >
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.85 }}
                  aria-label="Undo last swipe"
                  aria-keyshortcuts="u"
                  className={cn(
                    PHOTO_GLASS_BUTTON,
                    "size-12 shadow-[0_18px_40px_rgba(0,0,0,0.45)]",
                  )}
                  onClick={undo}
                >
                  <RotateCcw className="size-5 text-amber-300" aria-hidden="true" />
                </motion.button>
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.85 }}
                  whileHover={{ scale: 1.06 }}
                  aria-label="Pass"
                  aria-keyshortcuts="ArrowLeft"
                  className={cn(
                    PHOTO_GLASS_BUTTON,
                    "size-14 shadow-[0_18px_40px_rgba(0,0,0,0.45)]",
                  )}
                  onClick={() => act("PASS")}
                >
                  <X className="size-6" aria-hidden="true" />
                </motion.button>
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.85 }}
                  whileHover={{ scale: 1.08 }}
                  aria-label="Like"
                  aria-keyshortcuts="ArrowRight"
                  className="bg-primary text-primary-foreground hover:bg-primary/90 pointer-events-auto flex size-[4.5rem] items-center justify-center rounded-full shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_0_32px_color-mix(in_srgb,var(--primary)_50%,transparent),0_18px_44px_color-mix(in_srgb,var(--primary)_35%,transparent)] transition-colors focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
                  onClick={() => act("LIKE")}
                >
                  <Heart className="size-8 fill-current" aria-hidden="true" />
                </motion.button>
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.85 }}
                  whileHover={{ scale: 1.06 }}
                  aria-label="Super Like"
                  className={cn(
                    PHOTO_GLASS_BUTTON,
                    "size-12 shadow-[0_18px_40px_rgba(0,0,0,0.45)]",
                  )}
                  onClick={() => act("SUPER_LIKE")}
                >
                  <Star className="size-5 fill-sky-400 text-sky-400" aria-hidden="true" />
                </motion.button>
                {/* Message before matching - a plain button OUTSIDE the drag
                    surface, so opening the sheet can never read as a drag
                    (the card's own suppressTap guard covers on-card taps). */}
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.85 }}
                  whileHover={{ scale: 1.06 }}
                  aria-label={`Send ${top.displayName} a first message`}
                  className={cn(
                    PHOTO_GLASS_BUTTON,
                    "size-12 shadow-[0_18px_40px_rgba(0,0,0,0.45)]",
                  )}
                  onClick={() => {
                    setComposeFor(top);
                    setComposeOpen(true);
                  }}
                >
                  {/* Fixed gold - matches the assistant/suggestion colour in
                      chat; on-photo material stays theme-independent */}
                  <MessageCircle className="size-5 text-[#e7c9a1]" aria-hidden="true" />
                </motion.button>
              </div>
            )}

            {/* Subtle in-card confirmation after a first message lands */}
            <AnimatePresence>
              {sentChip && (
                <motion.div
                  key="message-sent"
                  role="status"
                  initial={{ opacity: 0, y: 10, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1, transition: SPRING.snappy }}
                  exit={{ opacity: 0, transition: { duration: 0.25 } }}
                  className="absolute inset-x-0 bottom-[calc(max(1rem,var(--safe-bottom))+11.25rem)] z-30 flex justify-center lg:bottom-[calc(var(--safe-bottom)+8rem)]"
                >
                  <span className="rounded-full border border-white/15 bg-white/10 px-3.5 py-1.5 text-xs font-medium text-white shadow-[0_12px_32px_rgba(0,0,0,0.4)] backdrop-blur-xl">
                    Message sent
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* First-message composer: bottom sheet on mobile, dialog on md+ */}
      <FirstMessageSheet
        profile={composeFor}
        viewerId={viewer?.id ?? null}
        reasonLine={composeReason}
        open={composeOpen}
        onOpenChange={setComposeOpen}
        onSent={handleMessageSent}
      />

      {/* Match celebration - the moment leads with what you share */}
      <Dialog open={!!matchedWith} onOpenChange={(open) => !open && setMatchedWith(null)}>
        <DialogContent className="border-border overflow-hidden rounded-2xl text-center sm:max-w-sm">
          {matchedWith && <HeartBurst />}
          {/* Gentle rise on top of the dialog's CSS fade - softSpring so the
              moment settles softly. MotionConfig reducedMotion="user" strips
              the translate and keeps the opacity crossfade. */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0, transition: softSpring }}
            className="grid gap-4"
          >
            <DialogHeader className="relative items-center space-y-3">
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ ...SPRING.bounce, delay: 0.1 }}
                className="bg-accent shadow-glow flex size-16 items-center justify-center rounded-full"
              >
                <Heart className="fill-primary text-primary size-8" aria-hidden="true" />
              </motion.span>
              <DialogTitle className="font-display text-3xl font-medium">
                It&apos;s a match
              </DialogTitle>
              <DialogDescription>
                {/* Explicit string child: this Next build's compiler strips
                    the leading space of JSX text that follows an expression
                    and runs to the line end ("Sadhbhliked" before). */}
                You and {matchedWith?.displayName}
                {" liked each other. Break the ice while it's warm."}
              </DialogDescription>
            </DialogHeader>
            {matchedWith && (
              <div className="relative pb-1">
                {matchChips.length > 0 ? (
                  <motion.ul
                    initial="hidden"
                    animate="show"
                    variants={{
                      hidden: {},
                      show: { transition: { staggerChildren: 0.1, delayChildren: 0.25 } },
                    }}
                    className="flex flex-wrap justify-center gap-1.5"
                    aria-label="What you share"
                  >
                    {matchChips.map((chip) => (
                      <motion.li
                        key={chip}
                        variants={{
                          hidden: { opacity: 0, y: 10, scale: 0.92 },
                          show: { opacity: 1, y: 0, scale: 1, transition: SPRING.snappy },
                        }}
                        className="border-primary/30 bg-primary/15 text-foreground rounded-full border px-3 py-1 text-xs font-medium"
                      >
                        {chip}
                      </motion.li>
                    ))}
                  </motion.ul>
                ) : matchedWith.promptTease ? (
                  <p className="text-muted-foreground text-sm">
                    <span className="italic">&ldquo;{matchedWith.promptTease.answer}&rdquo;</span>
                    {" - "}their {lowerLabel(matchedWith.promptTease.label)}
                  </p>
                ) : matchedWith.goalLine ? (
                  <p className="text-muted-foreground text-sm">{matchedWith.goalLine}</p>
                ) : null}
              </div>
            )}
            <div className="relative grid gap-2">
              <Button className="h-12 rounded-full" asChild>
                <Link
                  href={
                    matchedWith?.conversationId ? `/chat/${matchedWith.conversationId}` : "/chat"
                  }
                >
                  Say hello
                </Link>
              </Button>
              {opener ? (
                <Button variant="outline" className="h-11 rounded-full" asChild>
                  <Link
                    href={`${matchedWith?.conversationId ? `/chat/${matchedWith.conversationId}` : "/chat"}?suggest=${encodeURIComponent(opener.send)}`}
                  >
                    {opener.label}
                  </Link>
                </Button>
              ) : firstSharedInterest ? (
                <Button variant="outline" className="h-11 rounded-full" asChild>
                  <Link
                    href={`${matchedWith?.conversationId ? `/chat/${matchedWith.conversationId}` : "/chat"}?suggest=${encodeURIComponent(
                      `We both picked ${firstSharedInterest.toLowerCase()} - I have to ask, what's your favourite?`,
                    )}`}
                  >
                    Ask about {firstSharedInterest.toLowerCase()}
                  </Link>
                </Button>
              ) : null}
              <Button variant="ghost" className="rounded-full" onClick={() => setMatchedWith(null)}>
                Keep swiping
              </Button>
            </div>
          </motion.div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
