import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck, Compass, MapPin, Sparkles } from "lucide-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDiscoverFeed } from "@/lib/services/discovery";
import { getExploreCategories, track } from "@/lib/services/explore";
import { PageHeader } from "@/components/shared/page-header";
import { ExploreCard } from "@/components/explore/explore-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { initialsOf } from "@/lib/utils";

export const metadata: Metadata = { title: "Explore" };
export const dynamic = "force-dynamic";

const GROUP_LABELS: Record<string, string> = {
  LIFESTYLE: "Lifestyle",
  INTERESTS: "Interests",
  GOALS: "Relationship goals",
  TODAY: "Today",
  PERSONALITY: "Personality",
  COMMUNITIES: "Communities",
};
const GROUP_ORDER = ["TODAY", "GOALS", "LIFESTYLE", "INTERESTS", "PERSONALITY", "COMMUNITIES"];

export default async function ExplorePage() {
  const session = await auth();
  const userId = session!.user.id;
  const [categories, recommended, me] = await Promise.all([
    getExploreCategories(userId),
    getDiscoverFeed(userId, 6),
    db.profile.findUnique({
      where: { userId },
      select: {
        relationshipGoal: true,
        interests: { take: 2, select: { interest: { select: { label: true } } } },
      },
    }),
  ]);
  track("explore_opened", userId);

  const GOAL_LABELS: Record<string, string> = {
    LONG_TERM: "Long-term relationship", SHORT_TERM: "Casual dating",
    OPEN_TO_EITHER: "Open to either", FRIENDSHIP: "New friends", FIGURING_OUT: "Figuring it out",
  };
  const becauseBits = [
    ...(me?.interests.map((i) => i.interest.label) ?? []),
    ...(me ? [GOAL_LABELS[me.relationshipGoal]] : []),
  ].filter(Boolean);

  const grouped = GROUP_ORDER.map((g) => ({
    group: g,
    label: GROUP_LABELS[g],
    cards: categories.filter((c) => c.group === g && c.count > 0),
    hadAny: categories.some((c) => c.group === g),
  })).filter((s) => s.hadAny);

  if (categories.length === 0 && recommended.length === 0) {
    return (
      <>
        <PageHeader title="Explore" description="Find people with similar relationship goals." />
        <EmptyState icon={Compass} title="Explore is warming up" description="Categories are being curated. Check back soon." />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Explore" description="Find people with similar relationship goals." />
      <div className="space-y-10">
        {/* ============ A. Recommended for you - real people first ============ */}
        {recommended.length > 0 && (
          <section aria-labelledby="explore-recommended">
            <div className="mb-3 px-1">
              <h2 id="explore-recommended" className="text-xs font-semibold uppercase tracking-[0.3em] text-gold">
                Recommended for you
              </h2>
              {becauseBits.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Because you chose {becauseBits.slice(0, 2).join(" and ")}
                </p>
              )}
            </div>
            <div className="scrollbar-none -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0">
              {recommended.map((p) => (
                <div key={p.userId} className="w-[240px] shrink-0 snap-start overflow-hidden rounded-3xl border border-white/8 bg-card/80 shadow-card md:w-auto">
                  <div className="relative aspect-4/5 bg-muted">
                    {p.photos[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.photos[0].url} alt={`${p.displayName}'s photo`} loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-gradient-to-br from-white/10 to-transparent font-display text-3xl text-white/60">
                        {initialsOf(p.displayName)}
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 space-y-1 bg-gradient-to-t from-black/85 to-transparent p-3.5 pt-10">
                      <p className="flex items-center gap-1.5 font-semibold text-white">
                        {p.displayName}, {p.age}
                        {p.isVerified && <BadgeCheck className="size-4 fill-sky-400 text-black/40" aria-label="Photo verified" />}
                      </p>
                      <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-white/80">
                        <span className="flex items-center gap-1 text-gold">
                          <Sparkles className="size-3" aria-hidden="true" />{p.compatibility}% match
                        </span>
                        {p.city && (
                          <span className="flex items-center gap-0.5"><MapPin className="size-3" aria-hidden="true" />{p.city}</span>
                        )}
                      </p>
                      {p.interests.length > 0 && (
                        <p className="line-clamp-1 text-[11px] text-white/70">{p.interests.slice(0, 3).join(" · ")}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 px-1">
              <Button className="rounded-full" asChild>
                <Link href="/discover">Start discovery</Link>
              </Button>
            </div>
          </section>
        )}

        {/* ============ B-E. Category sections - carousels on mobile ============ */}
        {grouped.map(({ group, label, cards }) => (
          <section key={group} aria-labelledby={`explore-${group}`}>
            <h2 id={`explore-${group}`} className="mb-3 px-1 text-xs font-semibold uppercase tracking-[0.3em] text-gold">
              {label}
            </h2>
            {cards.length === 0 ? (
              <p className="glass rounded-3xl px-5 py-4 text-sm text-muted-foreground">
                No one here yet - try{" "}
                <Link href="/explore/coffee-dates" className="font-medium text-primary-soft underline-offset-2 hover:underline">Coffee dates</Link>{" "}
                or{" "}
                <Link href="/explore/weekend-plans" className="font-medium text-primary-soft underline-offset-2 hover:underline">Weekend plans</Link>.
              </p>
            ) : (
              <div className="scrollbar-none -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0">
                {cards.map((card) => (
                  <div key={card.slug} className="w-[260px] shrink-0 md:w-auto">
                    <ExploreCard card={card} />
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
