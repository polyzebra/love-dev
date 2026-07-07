import { GOAL_LINES } from "@/lib/discovery/taxonomy";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BadgeCheck,
  Briefcase,
  Camera,
  ChevronDown,
  CircleDashed,
  GraduationCap,
  Heart,
  Languages,
  MapPin,
  MessageSquareQuote,
  PenLine,
  Settings,
  Ruler,
} from "lucide-react";
import { requireUser } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import { promptLabel } from "@/config/prompts";
import { calculateAge, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Reveal, RevealGroup, RevealItem } from "@/components/fx/reveal";

export const metadata: Metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

const GOAL_LABELS: Record<string, string> = GOAL_LINES;

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
    <div className="relative flex size-16 items-center justify-center" aria-label={`Profile ${value}% complete`}>
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
      <span className="text-sm font-semibold tabular-nums text-white">{value}%</span>
    </div>
  );
}

export default async function ProfilePage() {
  const user = await requireUser();
  const profile = await db.profile.findUnique({
    where: { userId: user.id },
    include: {
      interests: { include: { interest: true } },
      prompts: { orderBy: { sortOrder: "asc" } },
      user: {
        select: {
          photos: { orderBy: [{ isCover: "desc" }, { position: "asc" }] },
          verifications: { where: { status: "APPROVED" }, select: { type: true } },
        },
      },
    },
  });
  if (!profile) redirect("/onboarding");

  const verifiedTypes = new Set(profile.user.verifications.map((v) => v.type));
  const photos = profile.user.photos;
  const cover = photos[0];
  const age = calculateAge(profile.birthDate);
  const prompts = profile.prompts;

  const basics = [
    profile.heightCm && { icon: Ruler, label: `${profile.heightCm} cm` },
    profile.occupation && { icon: Briefcase, label: profile.occupation },
    profile.education && {
      icon: GraduationCap,
      label: profile.education.toLowerCase().replace(/_/g, " "),
    },
    profile.languages.length > 0 && { icon: Languages, label: profile.languages.join(", ") },
  ].filter(Boolean) as { icon: typeof Ruler; label: string }[];

  return (
    <div className="space-y-6">
      {/* ================= COVER - magazine opener ================= */}
      <Reveal y={16}>
        <section className="relative overflow-hidden rounded-[36px] border border-border shadow-float">
          <div className="relative aspect-4/5 sm:aspect-square md:aspect-4/3">
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cover.url} alt="Your cover photo" className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <div className="absolute inset-0" style={{ background: coverGradient(profile.userId) }} />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-black/10" />
            <div className="absolute inset-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]" />

            {/* Top rail: completion + edit */}
            <div className="absolute inset-x-5 top-5 flex items-start justify-between">
              <CompletionRing value={profile.completionPct} />
              <Button size="icon" variant="secondary" className="glass-chip size-11 rounded-full border-0" aria-label="Settings" asChild>
                <Link href="/settings">
                  <Settings className="size-5" aria-hidden="true" />
                </Link>
              </Button>
            </div>

            {/* Identity - editorial lockup */}
            <div className="absolute inset-x-0 bottom-0 space-y-3 p-6 md:p-9">
              <h1 className="flex flex-wrap items-center gap-3 font-display text-[clamp(2.2rem,6vw,4rem)] font-medium leading-none tracking-tight text-white">
                {profile.displayName}, {age}
                {verifiedTypes.has("PHOTO") && (
                  <span role="img" className="relative flex items-center justify-center" aria-label="Photo verified">
                    <span className="absolute size-8 animate-ping-soft rounded-full bg-sky-400/25" />
                    <BadgeCheck className="relative size-8 fill-sky-400 text-white" />
                  </span>
                )}
              </h1>
              <p className="flex items-center gap-1.5 text-sm text-white/80">
                <MapPin className="size-4" aria-hidden="true" />
                {profile.city}
                {profile.country === "IE" ? ", Ireland" : ", UK"}
              </p>
              <Badge className="rounded-full border-0 bg-white/15 px-4 py-1.5 text-white backdrop-blur-md">
                <Heart className="size-3.5 fill-current" aria-hidden="true" />
                {GOAL_LABELS[profile.relationshipGoal]}
              </Badge>
            </div>
          </div>
        </section>
      </Reveal>

      {/* ================= TRUST ================= */}
      <RevealGroup className="grid gap-2.5 sm:grid-cols-3">
        {(
          [
            ["EMAIL", "Email verified"],
            ["PHONE", "Phone verified"],
            ["PHOTO", "Photo verified"],
          ] as const
        ).map(([type, label]) => {
          const done = verifiedTypes.has(type);
          return (
            <RevealItem key={type}>
              <div className="glass flex items-center gap-2.5 rounded-3xl px-4 py-3.5 text-sm">
                {done ? (
                  <BadgeCheck className="size-5 shrink-0 text-success" aria-hidden="true" />
                ) : (
                  <CircleDashed className="size-5 shrink-0 text-muted-foreground/40" aria-hidden="true" />
                )}
                <span className={done ? "" : "text-muted-foreground"}>{label}</span>
                {!done && (
                  <Button variant="link" size="sm" className="ml-auto h-auto p-0" asChild>
                    <Link href="/settings/account">Verify</Link>
                  </Button>
                )}
              </div>
            </RevealItem>
          );
        })}
      </RevealGroup>

      {/* ================= GALLERY ================= */}
      <Reveal>
        <section>
          <div className="mb-3 flex items-baseline justify-between px-1">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-gold">Gallery</p>
            <p className="text-xs text-muted-foreground">{photos.length}/9 photos</p>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            {photos.slice(1).map((photo, i) => (
              <div key={photo.id} className="relative aspect-3/4 overflow-hidden rounded-2xl border border-border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt={`Photo ${i + 2}`} className="h-full w-full object-cover" />
              </div>
            ))}
            {photos.length < 9 && (
              <button
                type="button"
                className="flex aspect-3/4 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-foreground/15 text-muted-foreground transition-colors hover:border-primary-soft hover:text-primary-soft"
                aria-label="Add photo"
              >
                <Camera className="size-5" aria-hidden="true" />
                <span className="text-[11px] font-medium">Add photo</span>
              </button>
            )}
          </div>
          {photos.length < 2 && (
            <p className="mt-2 px-1 text-xs text-warning">
              Add at least 2 photos to appear in Discover.
            </p>
          )}
        </section>
      </Reveal>

      {/* ================= IN THEIR WORDS ================= */}
      {profile.bio ? (
        <Reveal>
          <section className="px-2 py-4 md:px-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-gold">In my words</p>
            <blockquote className="mt-3 font-display text-2xl italic leading-snug text-foreground/95 md:text-3xl">
              &ldquo;{profile.bio}&rdquo;
            </blockquote>
          </section>
        </Reveal>
      ) : (
        <Reveal>
          <section className="glass rounded-[28px] p-6 text-center">
            <p className="text-sm text-muted-foreground">
              No bio yet - profiles with a story get far more matches.{" "}
              <Link href="/settings" className="font-medium text-primary-soft underline-offset-2 hover:underline">
                Write yours
              </Link>
            </p>
          </section>
        </Reveal>
      )}

      {/* ================= YOUR PROMPTS - editorial Q&A ================= */}
      {prompts.length > 0 && (
        <Reveal>
          <section className="glass rounded-[28px] p-6 md:p-8">
            <div className="mb-5 flex items-baseline justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-gold">Your prompts</p>
              <Button variant="link" size="sm" className="h-auto p-0 text-xs" asChild>
                <Link href="/profile/prompts">
                  <PenLine className="size-3.5" aria-hidden="true" />
                  Edit
                </Link>
              </Button>
            </div>
            <div className="space-y-6">
              {prompts.map((p) => (
                <div key={p.promptKey}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    {promptLabel(p.promptKey)}
                  </p>
                  <p className="mt-1.5 font-display text-xl leading-snug text-foreground/95 md:text-2xl">
                    {p.answer}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </Reveal>
      )}
      {prompts.length < 3 && (
        <Reveal>
          <section className="glass flex flex-col items-center gap-3 rounded-[28px] border border-dashed border-foreground/15 p-7 text-center">
            <span className="glass-chip flex size-12 items-center justify-center rounded-full">
              <MessageSquareQuote className="size-5 text-gold" aria-hidden="true" />
            </span>
            <div className="space-y-1">
              <p className="font-display text-xl font-medium tracking-tight">
                {prompts.length === 0 ? "Add your first prompt" : "Answer a few more prompts"}
              </p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Your answers become conversation starters - people reply to your words, not your stats.
              </p>
            </div>
            <Button className="mt-1 rounded-full px-6" asChild>
              <Link href="/profile/prompts">Answer prompts</Link>
            </Button>
          </section>
        </Reveal>
      )}

      {/* ================= INTEREST CLOUD ================= */}
      {profile.interests.length > 0 && (
        <Reveal>
          <section className="glass rounded-[28px] p-6">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.3em] text-gold">
              Into
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {profile.interests.map(({ interest }, i) => (
                <span
                  key={interest.id}
                  className={cn(
                    "rounded-full border border-border bg-foreground/5 font-medium",
                    i % 3 === 0 ? "px-4 py-2 text-sm" : "px-3 py-1.5 text-xs",
                    i % 4 === 0 && "bg-primary/12 text-primary-soft",
                  )}
                >
                  {interest.label}
                </span>
              ))}
            </div>
          </section>
        </Reveal>
      )}

      {/* ================= THE BASICS - demoted, collapsed ================= */}
      {basics.length > 0 && (
        <Reveal>
          <details className="group rounded-[28px] border border-border bg-card/40">
            <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-4 text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground [&::-webkit-details-marker]:hidden">
              The basics
              <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="grid gap-2.5 px-6 pb-5 sm:grid-cols-2">
              {basics.map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                  <Icon className="size-4 shrink-0 opacity-60" aria-hidden="true" />
                  <span className="truncate capitalize">{label}</span>
                </div>
              ))}
            </div>
          </details>
        </Reveal>
      )}
    </div>
  );
}
