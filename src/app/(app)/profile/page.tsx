import { GOAL_LINES } from "@/lib/discovery/taxonomy";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BadgeCheck,
  Briefcase,
  ChevronDown,
  CircleDashed,
  GraduationCap,
  Languages,
  MessageSquareQuote,
  PenLine,
  Ruler,
} from "lucide-react";
import { requireUser } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import { promptLabel } from "@/config/prompts";
import { calculateAge, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PhotoManager } from "@/components/profile/photo-manager";
import { Reveal, RevealGroup, RevealItem } from "@/components/fx/reveal";

export const metadata: Metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

const GOAL_LABELS: Record<string, string> = GOAL_LINES;

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
      {/* ============ COVER + GALLERY - client-managed photos ============ */}
      <PhotoManager
        initialPhotos={photos}
        completionPct={profile.completionPct}
        displayName={profile.displayName}
        age={age}
        city={profile.city}
        country={profile.country}
        goalLabel={GOAL_LABELS[profile.relationshipGoal]}
        photoVerified={verifiedTypes.has("PHOTO")}
        gradientSeed={profile.userId}
      >
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
      </PhotoManager>

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
