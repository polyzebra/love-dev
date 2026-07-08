import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, UserSearch } from "lucide-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { exploreFiltersSchema } from "@/lib/validators/explore";
import { getExploreMatches, getExploreProfile, track } from "@/lib/services/explore";
import { ExplorePersonCard } from "@/components/explore/person-card";
import { ExploreProfileViewer } from "@/components/explore/profile-viewer";
import { ExploreCard3DVisual } from "@/components/explore/explore-card";
import { ExploreFilterSheet } from "@/components/explore/filter-sheet";
import { ExplorePreferenceToggle } from "@/components/explore/preference-toggle";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Explore" };
export const dynamic = "force-dynamic";

export default async function ExploreCategoryPage({
  params, searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const [{ slug }, rawFilters, session] = await Promise.all([params, searchParams, auth()]);
  const userId = session!.user.id;
  const { profile: profileParam, ...filterParams } = rawFilters;
  const filters = exploreFiltersSchema.safeParse(filterParams);
  const viewerProfile = profileParam ? await getExploreProfile(userId, profileParam) : null;
  const result = await getExploreMatches(userId, slug, filters.success ? filters.data : {});
  if (!result) notFound();
  const { category, users, total, page, pageSize } = result;

  const saved = !!(await db.userExplorePreference.findUnique({
    where: { userId_categoryId: { userId, categoryId: category.id } },
  }));
  track("explore_category_viewed", userId, { slug });

  const hasFilters = Object.keys(filterParams).length > 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      {/* Category hero */}
      <section
        className="relative mb-6 overflow-hidden rounded-[32px] border border-border p-6 shadow-card"
        style={{ background: `radial-gradient(130% 120% at 20% 0%, ${category.gradientFrom}40, transparent 60%), radial-gradient(120% 130% at 90% 100%, ${category.gradientTo}30, transparent 55%)` }}
      >
        <div className="flex items-start justify-between">
          <Button variant="ghost" size="icon" className="rounded-full" aria-label="Back to Explore" asChild>
            <Link href="/explore"><ArrowLeft className="size-5" /></Link>
          </Button>
          <ExplorePreferenceToggle categoryId={category.id} initialSaved={saved} />
        </div>
        <div className="mt-2 flex items-center gap-5">
          <ExploreCard3DVisual iconKey={category.iconKey} imageUrl={category.imageUrl} from={category.gradientFrom} to={category.gradientTo} title={category.title} />
          <div>
            <h1 className="font-display text-3xl font-medium tracking-tight md:text-4xl">{category.title}</h1>
            {category.description && <p className="mt-1 max-w-md text-sm text-muted-foreground">{category.description}</p>}
            <p className="mt-2 text-xs font-medium tabular-nums text-gold">{total} people here now</p>
          </div>
        </div>
      </section>

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-[0.25em] text-muted-foreground">People</h2>
        <ExploreFilterSheet />
      </div>

      {users.length === 0 ? (
        <EmptyState
          icon={UserSearch}
          title={hasFilters ? "No one matches those filters" : "Be the first here"}
          description={
            hasFilters
              ? "Loosen the filters to see more people from this circle."
              : "Add this to your interests so others can find you here - and check that your profile carries the right interests."
          }
          action={
            <Button variant="outline" className="rounded-full" asChild>
              <Link href={hasFilters ? `/explore/${slug}` : "/profile"}>{hasFilters ? "Clear filters" : "Add this to your profile"}</Link>
            </Button>
          }
        />
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {users.map((u) => (
              <li key={u.userId}>
                <ExplorePersonCard person={u} />
              </li>
            ))}
          </ul>
          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-3 text-sm">
              {page > 1 && (
                <Button variant="outline" className="rounded-full" asChild>
                  <Link href={`/explore/${slug}?${new URLSearchParams({ ...filterParams, page: String(page - 1) })}`}>Previous</Link>
                </Button>
              )}
              <span className="tabular-nums text-muted-foreground">{page} / {totalPages}</span>
              {page < totalPages && (
                <Button variant="outline" className="rounded-full" asChild>
                  <Link href={`/explore/${slug}?${new URLSearchParams({ ...filterParams, page: String(page + 1) })}`}>Next</Link>
                </Button>
              )}
            </div>
          )}
        </>
      )}

      {profileParam && viewerProfile && (
        <ExploreProfileViewer
          profile={viewerProfile}
          slug={slug}
          queue={users.map((u) => ({ userId: u.userId, photoUrl: u.photo?.url ?? null }))}
        />
      )}
      {profileParam && !viewerProfile && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-background/95 p-6 backdrop-blur-xl" role="alertdialog" aria-label="Profile unavailable">
          <div className="glass max-w-xs space-y-4 rounded-[28px] p-6 text-center">
            <p className="font-display text-xl">This profile isn&apos;t available</p>
            <p className="text-sm text-muted-foreground">It may have been hidden or is no longer on Tirvea.</p>
            <Button className="rounded-full" asChild>
              <Link href={`/explore/${slug}`}>Back to Explore</Link>
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
