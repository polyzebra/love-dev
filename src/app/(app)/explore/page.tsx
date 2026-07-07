import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck, ChevronRight, Compass, Sparkles } from "lucide-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDiscoverFeed, type DiscoverProfile } from "@/lib/services/discovery";
import { getExploreCategories, getExploreMatches, track } from "@/lib/services/explore";
import { ExploreCard, type ExploreCardData } from "@/components/explore/explore-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { OnlineDot } from "@/components/shared/online-dot";
import { initialsOf } from "@/lib/utils";

export const metadata: Metadata = { title: "Explore" };
export const dynamic = "force-dynamic";

/** Netflix-class discovery: horizontal rows of PEOPLE, not categories. */

const GOAL_ROW: Record<string, string> = {
  LONG_TERM: "long-term-partner",
  SHORT_TERM: "casual-dating",
  OPEN_TO_EITHER: "serious-relationship",
  FRIENDSHIP: "new-friends",
  FIGURING_OUT: "casual-dating",
};

type RowPerson = {
  userId: string;
  displayName: string;
  age: number;
  city: string | null;
  isVerified: boolean;
  isOnline: boolean;
  sharedInterests: number;
  photo: { url: string } | null;
};

function PersonTile({
  person, href, size = "md",
}: { person: RowPerson; href: string; size?: "md" | "lg" }) {
  return (
    <Link
      href={href}
      className={`group relative shrink-0 snap-start overflow-hidden rounded-3xl border border-white/8 bg-card/80 shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-float ${size === "lg" ? "w-[240px]" : "w-[190px]"}`}
      aria-label={`View ${person.displayName}'s profile`}
    >
      <div className={`relative bg-muted ${size === "lg" ? "aspect-[4/5.4]" : "aspect-[4/5.6]"}`}>
        {person.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={person.photo.url} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]" />
        ) : (
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-white/10 to-transparent font-display text-3xl text-white/60">
            {initialsOf(person.displayName)}
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-3 pt-10">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-white">
            <span className="truncate">{person.displayName}, {person.age}</span>
            {person.isVerified && <BadgeCheck className="size-4 shrink-0 fill-sky-400 text-black/40" aria-label="Verified" />}
            <OnlineDot online={person.isOnline} className="ml-auto shrink-0" />
          </p>
          {person.sharedInterests > 0 ? (
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-white/80">
              <Sparkles className="size-3 text-gold" aria-hidden="true" />
              {person.sharedInterests} shared
            </p>
          ) : person.city ? (
            <p className="mt-0.5 truncate text-[11px] text-white/70">{person.city}</p>
          ) : null}
        </div>
        {/* Hover CTA - desktop reveal */}
        <span className="pointer-events-none absolute right-3 top-3 translate-y-1 rounded-full bg-white/90 px-3 py-1 text-[11px] font-semibold text-black opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
          View →
        </span>
      </div>
    </Link>
  );
}

function Row({
  title, reason, count, online, seeAllHref, children,
}: {
  title: string; reason?: string; count?: number; online?: number;
  seeAllHref?: string; children: React.ReactNode;
}) {
  return (
    <section aria-label={title}>
      <div className="mb-3 flex items-end justify-between gap-4 px-1">
        <div>
          <h2 className="font-display text-xl font-medium tracking-tight md:text-2xl">{title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {reason}
            {count != null && (
              <span className="tabular-nums">
                {reason ? " · " : ""}{count} people
                {online ? <span className="text-emerald-400"> · {online} online</span> : null}
              </span>
            )}
          </p>
        </div>
        {seeAllHref && (
          <Link href={seeAllHref} className="flex shrink-0 items-center gap-0.5 text-sm font-medium text-primary-soft hover:underline">
            See all <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        )}
      </div>
      <div className="scrollbar-none -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 md:-mx-6 md:px-6 2xl:-mx-10 2xl:px-10">
        {children}
      </div>
    </section>
  );
}

export default async function ExplorePage() {
  const session = await auth();
  const userId = session!.user.id;

  const me = await db.profile.findUnique({
    where: { userId },
    select: {
      country: true, city: true, relationshipGoal: true,
      interests: { take: 2, select: { interest: { select: { label: true } } } },
    },
  });
  track("explore_opened", userId);

  const goalSlug = GOAL_ROW[me?.relationshipGoal ?? "LONG_TERM"];
  const nearbySlug = me?.country === "GB" ? "uk-singles" : "irish-singles";
  const rowSlugs = [
    { slug: "free-tonight", reason: "Online recently and open to plans" },
    { slug: goalSlug, reason: "Because you're looking for the same thing" },
    { slug: "coffee-dates", reason: "The easiest first date there is" },
    { slug: nearbySlug, reason: me?.city ? `People around ${me.city}` : "People near you" },
    { slug: "music-lovers", reason: "Gig buddies and playlist swappers" },
  ].filter((r, i, all) => all.findIndex((x) => x.slug === r.slug) === i);

  const [recommended, categories, ...rows] = await Promise.all([
    getDiscoverFeed(userId, 10),
    getExploreCategories(userId),
    ...rowSlugs.map((r) => getExploreMatches(userId, r.slug, { pageSize: 10 })),
  ]);

  const liveRows = rows
    .map((res, i) => ({ res, reason: rowSlugs[i].reason }))
    .filter((r): r is { res: NonNullable<(typeof rows)[number]>; reason: string } => !!r.res && r.res.users.length > 0);

  const interestBits = me?.interests.map((i) => i.interest.label) ?? [];

  // Development safety net: never a blank Explore while iterating locally.
  const DEV_DEMO: (ExploreCardData & { group: string })[] =
    process.env.NODE_ENV === "development" && categories.length === 0
      ? [
          { slug: "coffee-dates", title: "Coffee dates", description: "Demo - run npx prisma db seed", group: "LIFESTYLE", iconKey: "coffee", imageUrl: null, gradientFrom: "#d9a066", gradientTo: "#7a4a21", count: 0, online: 0, saved: false, preview: [] },
          { slug: "long-term-partner", title: "Long-term partner", description: "Demo - run npx prisma db seed", group: "GOALS", iconKey: "long-term", imageUrl: null, gradientFrom: "#fb7185", gradientTo: "#881337", count: 0, online: 0, saved: false, preview: [] },
          { slug: "free-tonight", title: "Free tonight", description: "Demo - run npx prisma db seed", group: "TODAY", iconKey: "tonight", imageUrl: null, gradientFrom: "#818cf8", gradientTo: "#1e1b4b", count: 0, online: 0, saved: false, preview: [] },
        ]
      : [];
  const allCategories = categories.length > 0 ? categories : DEV_DEMO;

  const GROUP_LABELS: Record<string, string> = {
    TODAY: "Today", GOALS: "Relationship goals", LIFESTYLE: "Lifestyle",
    INTERESTS: "Interests", PERSONALITY: "Personality", COMMUNITIES: "Communities",
  };
  const catSections = ["TODAY", "GOALS", "LIFESTYLE", "INTERESTS", "PERSONALITY", "COMMUNITIES"]
    .map((g) => ({ group: g, label: GROUP_LABELS[g], cards: allCategories.filter((c) => c.group === g) }))
    .filter((sec) => sec.cards.length > 0);

  if (recommended.length === 0 && liveRows.length === 0 && catSections.length === 0) {
    return (
      <>
        <h1 className="pb-6 font-display text-3xl font-medium tracking-tight md:text-4xl">Explore</h1>
        <EmptyState
          icon={Compass}
          title="No one to show just yet"
          description="Widen your discovery preferences, or check back soon - new people join every day."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button className="rounded-full" asChild><Link href="/settings/discovery">Update preferences</Link></Button>
              <Button variant="outline" className="rounded-full" asChild><Link href="/discover">Go to Discover</Link></Button>
              <Button variant="outline" className="rounded-full" asChild><Link href="/profile">Complete profile</Link></Button>
            </div>
          }
        />
      </>
    );
  }

  return (
    <div className="space-y-10">
      {/* Recommended - the hero row, larger tiles */}
      {recommended.length > 0 && (
        <Row
          title="Recommended for you"
          reason={interestBits.length > 0 ? `Because you like ${interestBits.join(" and ")}` : "Tuned to your profile"}
          seeAllHref="/discover"
        >
          {recommended.map((p: DiscoverProfile) => (
            <PersonTile
              key={p.userId}
              size="lg"
              href={`/discover`}
              person={{
                userId: p.userId, displayName: p.displayName, age: p.age, city: p.city,
                isVerified: p.isVerified, isOnline: p.isOnline,
                sharedInterests: 0, photo: p.photos[0] ? { url: p.photos[0].url } : null,
              }}
            />
          ))}
        </Row>
      )}

      {/* Category rows - people inside, category as the "See all" gateway */}
      {/* Category layer - always present, the gateway grid */}
      {catSections.map(({ group, label, cards }) => (
        <section key={group} aria-labelledby={`explore-cat-${group}`}>
          <h2 id={`explore-cat-${group}`} className="mb-3 px-1 text-xs font-semibold uppercase tracking-[0.3em] text-gold">
            {label}
          </h2>
          <div className="scrollbar-none -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-[repeat(auto-fill,minmax(250px,1fr))] md:overflow-visible md:px-0">
            {cards.map((card) => (
              <div key={card.slug} className="w-[260px] shrink-0 md:w-auto">
                <ExploreCard card={card} />
              </div>
            ))}
          </div>
        </section>
      ))}

      {liveRows.map(({ res, reason }) => (
        <Row
          key={res.category.slug}
          title={res.category.title}
          reason={reason}
          count={res.total}
          online={res.users.filter((u) => u.isOnline).length}
          seeAllHref={`/explore/${res.category.slug}`}
        >
          {res.users.map((u) => (
            <PersonTile
              key={u.userId}
              href={`/explore/${res.category.slug}?profile=${u.userId}`}
              person={u}
            />
          ))}
        </Row>
      ))}
    </div>
  );
}
