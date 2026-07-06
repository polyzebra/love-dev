import type { Metadata } from "next";
import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDiscoverFeed } from "@/lib/services/discovery";
import { SwipeDeck, type ViewerContext } from "@/components/app/swipe-deck";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/page-header";

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
  const session = await auth();
  if (!session?.user?.id) return <SwipeDeck initialProfiles={[]} viewer={null} />;

  const [feed, me] = await Promise.all([
    getDiscoverFeed(session.user.id),
    db.profile.findUnique({
      where: { userId: session.user.id },
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
      }
    : null;

  return <SwipeDeck initialProfiles={feed} viewer={viewer} />;
}

export default function DiscoverPage() {
  return (
    <>
      <PageHeader
        title="Discover"
        description="Profiles picked for you, refreshed daily."
      />
      <Suspense fallback={<DeckSkeleton />}>
        <Deck />
      </Suspense>
    </>
  );
}
