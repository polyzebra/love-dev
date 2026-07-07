import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BadgeCheck, Sparkles, UserSearch } from "lucide-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { exploreFiltersSchema } from "@/lib/validators/explore";
import { getExploreMatches, track } from "@/lib/services/explore";
import { ExploreCard3DVisual } from "@/components/explore/explore-card";
import { ExploreFilterSheet } from "@/components/explore/filter-sheet";
import { ExplorePreferenceToggle } from "@/components/explore/preference-toggle";
import { EmptyState } from "@/components/shared/empty-state";
import { OnlineDot } from "@/components/shared/online-dot";
import { Button } from "@/components/ui/button";
import { initialsOf } from "@/lib/utils";

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
  const filters = exploreFiltersSchema.safeParse(rawFilters);
  const result = await getExploreMatches(userId, slug, filters.success ? filters.data : {});
  if (!result) notFound();
  const { category, users, total, page, pageSize } = result;

  const saved = !!(await db.userExplorePreference.findUnique({
    where: { userId_categoryId: { userId, categoryId: category.id } },
  }));
  track("explore_category_viewed", userId, { slug });

  const hasFilters = Object.keys(rawFilters).length > 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      {/* Category hero */}
      <section
        className="relative mb-6 overflow-hidden rounded-[32px] border border-white/10 p-6 shadow-card"
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
              <Link href={hasFilters ? `/explore/${slug}` : "/settings"}>{hasFilters ? "Clear filters" : "Update profile"}</Link>
            </Button>
          }
        />
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {users.map((u) => (
              <li key={u.userId}>
                <div className="group relative overflow-hidden rounded-3xl border border-white/8 bg-card/80 shadow-card">
                  <div className="relative aspect-3/4 bg-muted">
                    {u.photo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={u.photo.url} alt={`${u.displayName}'s photo`} loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-gradient-to-br from-white/10 to-transparent font-display text-3xl text-white/60">
                        {initialsOf(u.displayName)}
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 pt-8">
                      <p className="flex items-center gap-1.5 text-sm font-semibold text-white">
                        {u.displayName}, {u.age}
                        {u.isVerified && <BadgeCheck className="size-4 shrink-0 fill-sky-400 text-black/40" aria-label="Photo verified" />}
                        <OnlineDot online={u.isOnline} className="ml-auto" />
                      </p>
                      {u.sharedInterests > 0 && (
                        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-white/80">
                          <Sparkles className="size-3 text-gold" aria-hidden="true" />
                          {u.sharedInterests} shared interest{u.sharedInterests > 1 ? "s" : ""}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-3 text-sm">
              {page > 1 && (
                <Button variant="outline" className="rounded-full" asChild>
                  <Link href={`/explore/${slug}?${new URLSearchParams({ ...rawFilters, page: String(page - 1) })}`}>Previous</Link>
                </Button>
              )}
              <span className="tabular-nums text-muted-foreground">{page} / {totalPages}</span>
              {page < totalPages && (
                <Button variant="outline" className="rounded-full" asChild>
                  <Link href={`/explore/${slug}?${new URLSearchParams({ ...rawFilters, page: String(page + 1) })}`}>Next</Link>
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}
