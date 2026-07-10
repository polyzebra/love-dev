import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/require-user";
import { getExploreCategories, track } from "@/lib/services/explore";
import { PageHeader } from "@/components/shared/page-header";
import { ExploreCard } from "@/components/explore/explore-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Compass } from "lucide-react";

export const metadata: Metadata = { title: "Explore" };

export default async function ExplorePage() {
  const user = await requireUser();
  // Grouped in taxonomy order: Right now / Relationship / Lifestyle /
  // Interests / Community. Saved categories float first inside each group.
  const groups = await getExploreCategories(user.id);
  track("explore_opened", user.id);

  if (groups.length === 0) {
    return (
      <>
        <PageHeader title="Explore" description="Find people by intent, energy and shared ground." />
        <EmptyState icon={Compass} title="Explore is warming up" description="Categories are being curated. Check back soon." />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Explore" description="Find people by intent, energy and shared ground." />
      <div className="mx-auto w-full max-w-6xl space-y-10">
        {groups.map(({ group, label, categories }) => (
          <section key={group} aria-labelledby={`explore-${group}`}>
            <h2 id={`explore-${group}`} className="mb-3 px-1 text-xs font-semibold uppercase tracking-[0.3em] text-gold">
              {label}
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {categories.map((card) => (
                <ExploreCard key={card.slug} card={card} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
