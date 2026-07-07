import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth/require-user";
import { db } from "@/lib/db";
import { getDiscoverFeed } from "@/lib/services/discovery";
import { SwipeDeck, type ViewerContext } from "@/components/app/swipe-deck";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import { ArrowLeft, Bell, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Discover" };
export const dynamic = "force-dynamic";

function DeckSkeleton() {
  return (
    <div className="mx-auto w-full max-w-sm">
      <Skeleton className="aspect-3/4 w-full rounded-[30px]" />
      <div className="mt-7 flex items-center justify-center gap-4">
        <Skeleton className="size-12 rounded-full" />
        <Skeleton className="size-16 rounded-full" />
        <Skeleton className="size-16 rounded-full" />
        <Skeleton className="size-12 rounded-full" />
      </div>
    </div>
  );
}

async function Deck() {
  const user = await requireUser();
  if (!user.id) return <SwipeDeck initialProfiles={[]} viewer={null} />;

  const [feed, me] = await Promise.all([
    getDiscoverFeed(user.id),
    db.profile.findUnique({
      where: { userId: user.id },
      select: {
        city: true,
        relationshipGoal: true,
        interests: { select: { interest: { select: { label: true } } } },
      },
    }),
  ]);

  const viewer: ViewerContext | null = me
    ? {
        city: me.city,
        interests: me.interests.map((i) => i.interest.label),
        goal: me.relationshipGoal,
      }
    : null;

  return <SwipeDeck initialProfiles={feed} viewer={viewer} />;
}

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const backHref = from?.startsWith("/explore") ? from : null;
  return (
    <>
      {/* Swipe header: contextual back (from Explore) left, filters right */}
      <header className="flex items-start justify-between gap-4 pb-6">
        <div className="flex items-center gap-2">
          {backHref && (
            <Button variant="ghost" size="icon" className="rounded-full" aria-label="Back to Explore" asChild>
              <Link href={backHref}><ArrowLeft className="size-5" /></Link>
            </Button>
          )}
          <div>
            <h1 className="font-display text-3xl font-medium tracking-tight md:text-4xl">Swipe</h1>
            <p className="text-sm text-muted-foreground md:text-base">Profiles picked for you, refreshed daily.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="size-11 rounded-full" aria-label="Notifications" asChild>
            <Link href="/notifications"><Bell className="size-5" /></Link>
          </Button>
          <Button variant="outline" size="icon" className="size-11 rounded-full" aria-label="Discovery preferences" asChild>
            <Link href="/settings/discovery"><SlidersHorizontal className="size-5" /></Link>
          </Button>
        </div>
      </header>
      <Suspense fallback={<DeckSkeleton />}>
        <Deck />
      </Suspense>
    </>
  );
}
