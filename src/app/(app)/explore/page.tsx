import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { getExploreCategories, track } from "@/lib/services/explore";
import { PageHeader } from "@/components/shared/page-header";
import { ExploreCard } from "@/components/explore/explore-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Compass } from "lucide-react";

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
  const categories = await getExploreCategories(session!.user.id);
  track("explore_opened", session!.user.id);

  if (categories.length === 0) {
    return (
      <>
        <PageHeader title="Explore" description="Find people with similar relationship goals." />
        <EmptyState icon={Compass} title="Explore is warming up" description="Categories are being curated. Check back soon." />
      </>
    );
  }

  const grouped = GROUP_ORDER.map((g) => ({
    group: g,
    label: GROUP_LABELS[g],
    cards: categories.filter((c) => c.group === g),
  })).filter((s) => s.cards.length > 0);

  return (
    <>
      <PageHeader title="Explore" description="Find people with similar relationship goals." />
      <div className="space-y-10">
        {grouped.map(({ group, label, cards }) => (
          <section key={group} aria-labelledby={`explore-${group}`}>
            <h2 id={`explore-${group}`} className="mb-3 px-1 text-xs font-semibold uppercase tracking-[0.3em] text-gold">
              {label}
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {cards.map((card) => <ExploreCard key={card.slug} card={card} />)}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
